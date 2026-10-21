"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import AuthCard from "@/components/auth/AuthCard";

export default function RecoverPage() {
    const [email, setEmail] = useState("");
    const [sending, setSending] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState("");

    async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (sending) return;
        setSending(true);
        setError("");
        try {
            const { error: authError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
                redirectTo: `${window.location.origin}/auth/password`,
            });
            if (authError) throw authError;
            setSent(true);
        } catch {
            setError("No pudimos enviar el enlace. Intenta de nuevo en unos minutos o contacta al administrador.");
        } finally {
            setSending(false);
        }
    }

    return (
        <AuthCard title="Recupera tu contraseña" description="Te enviaremos un enlace para crear una nueva contraseña.">
            {sent ? (
                <p role="status">Si el correo está registrado, recibirás un enlace. Revisa también spam y ábrelo en este mismo navegador.</p>
            ) : (
                <form onSubmit={handleSubmit}>
                    {error && <p role="alert" style={{ color: "var(--danger)", marginBottom: "16px" }}>{error}</p>}
                    <div className="form-group">
                        <label className="form-label" htmlFor="recovery-email" style={{ color: "var(--text-secondary)" }}>Correo electrónico</label>
                        <input id="recovery-email" className="input" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} disabled={sending} />
                    </div>
                    <button className="btn-primary" type="submit" disabled={sending} style={{ width: "100%", padding: "14px", justifyContent: "center" }}>
                        {sending ? "Enviando…" : "Enviar enlace"}
                    </button>
                </form>
            )}
        </AuthCard>
    );
}
