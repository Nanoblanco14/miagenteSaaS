import Link from "next/link";
import { LockKeyhole } from "lucide-react";

export default function AuthCard({ title, description, children }: {
    title: string;
    description: string;
    children: React.ReactNode;
}) {
    return (
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "24px", background: "var(--bg-primary)" }}>
            <section className="glass-card" style={{ width: "100%", maxWidth: "440px", padding: "32px" }}>
                <LockKeyhole size={28} style={{ color: "var(--accent-light)", marginBottom: "16px" }} />
                <h1 style={{ fontSize: "1.5rem", fontWeight: 700 }}>{title}</h1>
                <p style={{ color: "var(--text-secondary)", margin: "8px 0 24px", fontSize: "0.9rem" }}>{description}</p>
                {children}
                <Link href="/login" style={{ display: "block", marginTop: "24px", color: "var(--accent-light)", fontSize: "0.85rem" }}>
                    Volver al inicio de sesión
                </Link>
            </section>
        </main>
    );
}
