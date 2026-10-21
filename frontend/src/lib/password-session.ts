import type { SupabaseClient } from "@supabase/supabase-js";

/** Verify the identity before allowing a password change; never trust URL claims. */
export async function getPasswordUser(client: SupabaseClient, url: URL, clearFragment: () => void) {
    const hash = new URLSearchParams(url.hash.slice(1));
    const type = hash.get("type");
    const accessToken = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");
    const hasLinkError = hash.has("error") || hash.has("error_code") || url.searchParams.has("error");
    const isImplicitLink = type === "invite" || type === "recovery";

    // @supabase/ssr is always PKCE. Admin invitations still use an implicit fragment.
    // Wait for auto-initialization, then consume that fragment through the supported SDK.
    const { error: initializationError } = await client.auth.initialize();
    if (url.hash) clearFragment();
    if (hasLinkError) throw new Error("Este enlace venció o no es válido. Solicita uno nuevo.");
    if (isImplicitLink) {
        if (!accessToken || !refreshToken) throw new Error("El enlace está incompleto. Solicita uno nuevo.");
        const { error } = await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        if (error) throw new Error("No pudimos validar este enlace. Solicita uno nuevo.");
    } else if (initializationError) {
        throw new Error("No pudimos validar este enlace. Solicita uno nuevo y ábrelo en este mismo navegador.");
    }

    const { data, error } = await client.auth.getUser();
    if (error || !data.user?.email) {
        throw new Error("No hay una sesión activa. Inicia sesión o solicita un nuevo enlace desde este navegador.");
    }
    return data.user;
}
