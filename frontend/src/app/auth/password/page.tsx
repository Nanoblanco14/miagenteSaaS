"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import AuthCard from "@/components/auth/AuthCard";
import { getPasswordUser } from "@/lib/password-session";

export default function PasswordPage() {
    const [checking, setChecking] = useState(true);
    const [email, setEmail] = useState<string | null>(null);
    const [password, setPassword] = useState("");
    const [confirmation, setConfirmation] = useState("");
    const [error, setError] = useState("");
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        let active = true;
        (async () => {
            try {
                const user = await getPasswordUser(supabase, new URL(window.location.href), () => {
                    window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
                });
                if (!active) return;
                setEmail(user.email!);
            } catch (cause) {
                if (active) setError(cause instanceof Error ? cause.message : "No pudimos verificar tu sesión. Intenta de nuevo.");
            } finally {
                if (active) setChecking(false);
            }
        })();
        return () => { active = false; };
    }, []);

    async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!email || saving) return;
        setError("");
        if (password.length < 12) {
            setError("Usa una contraseña de al menos 12 caracteres.");
            return;
        }
        if (password !== confirmation) {
            setError("Las contraseñas no coinciden.");
            return;
        }
        setSaving(true);
        try {
            const { error: updateError } = await supabase.auth.updateUser({ password });
            if (updateError) throw updateError;
            setPassword("");
            setConfirmation("");
            setSaved(true);
            const { error: signOutError } = await supabase.auth.signOut({ scope: "global" });
            if (signOutError) setError("Tu contraseña se guardó, pero no pudimos cerrar las sesiones. Cierra sesión desde el panel.");
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "No pudimos guardar la contraseña. Intenta de nuevo.");
        } finally {
            setSaving(false);
        }
    }

    return (
        <AuthCard title="Tu contraseña" description="Crea una contraseña personal para entrar a MiAgente.">
            {checking ? <p role="status">Verificando tu sesión…</p> : (
                <>
                    {error && <p role="alert" style={{ color: "var(--danger)", marginBottom: "16px" }}>{error}</p>}
                    {saved ? (
                        <div role="status">
                            <p>Tu contraseña quedó guardada. Ya puedes iniciar sesión con ella.</p>
                        </div>
                    ) : email ? (
                        <form onSubmit={handleSubmit}>
                            <p style={{ marginBottom: "20px", overflowWrap: "anywhere" }}>{email}</p>
                            <div className="form-group">
                                <label className="form-label" htmlFor="new-password" style={{ color: "var(--text-secondary)" }}>Nueva contraseña</label>
                                <input id="new-password" className="input" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password} onChange={event => setPassword(event.target.value)} disabled={saving} />
                                <p style={{ color: "var(--text-secondary)", fontSize: "0.8rem", marginTop: "6px" }}>Al menos 12 caracteres.</p>
                            </div>
                            <div className="form-group">
                                <label className="form-label" htmlFor="confirm-password" style={{ color: "var(--text-secondary)" }}>Repite la contraseña</label>
                                <input id="confirm-password" className="input" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={saving} />
                            </div>
                            <button className="btn-primary" type="submit" disabled={saving} style={{ width: "100%", padding: "14px", justifyContent: "center" }}>
                                {saving ? "Guardando…" : "Guardar contraseña"}
                            </button>
                        </form>
                    ) : (
                        <Link className="btn-primary" href="/auth/recover" style={{ display: "block", padding: "14px", textAlign: "center" }}>Solicitar nuevo enlace</Link>
                    )}
                </>
            )}
        </AuthCard>
    );
}
