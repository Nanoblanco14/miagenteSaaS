const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

// Each case gets a fresh browser-client singleton and an in-memory Auth server.
// No requests leave the process and no real accounts or credentials are used.
async function scenario(name) {
    const user = { id: '00000000-0000-4000-8000-000000000001', email: 'test@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} };
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600, aud: 'authenticated' })}.test-signature`;
    const hash = ['invitation', 'rejected-invitation'].includes(name)
        ? `#access_token=${token}&refresh_token=test-refresh&type=invite&expires_in=3600&token_type=bearer`
        : name === 'expired' ? '#error=access_denied&error_code=otp_expired&error_description=Expired' : '';
    let url = new URL(`https://app.example.invalid/auth/password${name === 'recovery' ? '?code=test-code' : ''}${hash}`);
    const cookieJar = new Map();
    if (name === 'recovery') cookieJar.set('sb-test-auth-token-code-verifier', 'base64-' + Buffer.from(JSON.stringify('test-verifier/PASSWORD_RECOVERY')).toString('base64url'));
    global.window = {
        location: url,
        addEventListener() {}, removeEventListener() {},
        history: { state: null, replaceState(_state, _title, next) { url = new URL(next, url); global.window.location = url; } },
    };
    global.document = {
        visibilityState: 'visible',
        addEventListener() {}, removeEventListener() {},
        get cookie() { return [...cookieJar].map(([key, value]) => `${key}=${value}`).join('; '); },
        set cookie(value) { const [pair] = value.split(';'); const index = pair.indexOf('='); cookieJar.set(pair.slice(0, index), pair.slice(index + 1)); },
    };
    global.window.document = global.document;
    const local = new Map();
    Object.defineProperty(global, 'localStorage', { value: { getItem: key => local.get(key) || null, setItem: (key, value) => local.set(key, value), removeItem: key => local.delete(key) }, configurable: true });
    global.window.localStorage = global.localStorage;
    global.BroadcastChannel = undefined;
    const calls = [];
    global.fetch = async (input, options = {}) => {
        calls.push({ url: String(input), method: options.method || 'GET', body: options.body });
        assert.ok(String(input).startsWith('https://test.supabase.co/auth/v1/'));
        if (name === 'rejected-invitation') return new Response(JSON.stringify({ message: 'Invalid token' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
        if (String(input).includes('/token?')) return new Response(JSON.stringify({ access_token: token, refresh_token: 'test-refresh', expires_in: 3600, token_type: 'bearer', user }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        return new Response(JSON.stringify(user), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-publishable-key';
    const ts = require('typescript');
    function loadSource(filename) {
        const sourcePath = path.join(__dirname, '../src/lib', filename);
        const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
        const module = new Module(sourcePath, require.main);
        module.filename = sourcePath;
        module.paths = Module._nodeModulePaths(path.dirname(sourcePath));
        module._compile(compiled, sourcePath);
        return module.exports;
    }
    const client = loadSource('supabase.ts').supabase;
    const { getPasswordUser } = loadSource('password-session.ts');
    let cleared = false;
    const verify = () => getPasswordUser(client, url, () => { cleared = true; });
    if (name === 'invitation') {
        assert.equal((await verify()).id, user.id, 'An admin invitation must not be rejected as a PKCE mismatch');
        assert.equal(cleared, true, 'Remove tokens from the address bar');
        const update = await client.auth.updateUser({ password: 'Only-a-local-test-42!' });
        assert.equal(update.error, null);
        assert.ok(calls.some(call => call.method === 'PUT' && JSON.parse(call.body).password === 'Only-a-local-test-42!'));
    } else if (name === 'recovery') {
        assert.equal((await verify()).id, user.id);
        const exchange = calls.find(call => call.url.includes('grant_type=pkce'));
        assert.equal(JSON.parse(exchange.body).auth_code, 'test-code');
        assert.equal(JSON.parse(exchange.body).code_verifier, 'test-verifier');
    } else if (name === 'rejected-invitation') {
        await assert.rejects(verify, /validar este enlace/);
        assert.equal(calls.some(call => call.method === 'PUT'), false, 'Do not change passwords when Auth rejects the token');
    } else if (name === 'expired') {
        await assert.rejects(verify, /venció/);
        assert.equal(calls.length, 0, 'An expired link must not try to update an account');
    } else {
        await assert.rejects(verify, /sesión activa/);
        assert.equal(calls.length, 0, 'No authenticated request may be made without a session');
    }
    await client.auth.stopAutoRefresh();
}

if (process.argv[2] === 'scenario') {
    scenario(process.argv[3]).then(() => process.exit(0), error => { console.error(error); process.exit(1); });
} else {
    for (const name of ['invitation', 'recovery', 'rejected-invitation', 'expired', 'no-session']) {
        test(`Password Auth: ${name}`, () => {
            const result = spawnSync(process.execPath, [__filename, 'scenario', name], { encoding: 'utf8', timeout: 10000 });
            assert.equal(result.status, 0, result.stderr || result.error?.message);
        });
    }
}
