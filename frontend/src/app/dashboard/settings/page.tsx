"use client";
import { useOrg } from "@/lib/org-context";
import { useEffect, useState, useCallback } from "react";
import { updateTenantSettings, loadTenantSettings } from "./actions";
import {
    Settings, Building2, Key, Wifi,
    Eye, EyeOff, Check, Copy, Loader2, Save,
    AlertCircle, Phone, MessageCircle, ExternalLink,
} from "lucide-react";
import Link from "next/link";

type WhatsAppProvider = "twilio" | "meta";

const TWILIO_FIELDS = [
    { key: "account_sid", label: "Account SID", placeholder: "Tu Account SID de Twilio" },
    { key: "auth_token", label: "Auth Token", placeholder: "Token de autenticación" },
    { key: "phone_number", label: "Número WhatsApp", placeholder: "+56912345678" },
];
const META_FIELDS = [
    { key: "phone_number_id", label: "Phone Number ID", placeholder: "ID numérico del número" },
    { key: "access_token", label: "Access Token", placeholder: "Token de acceso permanente" },
    { key: "verify_token", label: "Verify Token", placeholder: "Token de verificación del webhook" },
    { key: "business_account_id", label: "Business Account ID", placeholder: "ID de la cuenta de negocio" },
];

/* ── Unified icon box ─────────────────────────────── */
function IconBox({ children }: { children: React.ReactNode }) {
    return (
        <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: "34px", height: "34px", borderRadius: "10px",
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.07)",
            color: "#a1a1aa", flexShrink: 0,
        }}>
            {children}
        </div>
    );
}

function SectionCard({ icon, title, subtitle, children, footer }: {
    icon: React.ReactNode; title: string; subtitle: string; children: React.ReactNode; footer?: React.ReactNode;
}) {
    return (
        <div className="glass-card" style={{ cursor: "default" }}>
            <div className="p-6">
                <div className="flex items-center gap-3 mb-5">
                    <IconBox>{icon}</IconBox>
                    <div>
                        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{title}</h3>
                        <p className="text-xs" style={{ color: "var(--text-muted)" }}>{subtitle}</p>
                    </div>
                </div>
                {children}
                {footer && <div className="mt-5 flex justify-end">{footer}</div>}
            </div>
        </div>
    );
}

function ReadOnlyField({ label, value, badge, mono }: { label: string; value?: string; badge?: string; mono?: boolean }) {
    return (
        <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">{label}</label>
            {badge ? (
                <span className="badge badge-active" style={{ textTransform: "capitalize" }}>{badge}</span>
            ) : (
                <input className="input" value={value || ""} readOnly
                    style={{ opacity: 0.6, cursor: "default", ...(mono ? { fontSize: "0.7rem", fontFamily: "monospace" } : {}) }} />
            )}
        </div>
    );
}

function SaveButton({ label, section, saving, saved, onClick }: {
    label: string; section: string; saving: string | null; saved: string | null; onClick: () => void;
}) {
    const isSaving = saving === section;
    const isSaved = saved === section;
    return (
        <button className="btn-primary" onClick={onClick} disabled={isSaving}
            style={{
                display: "flex", alignItems: "center", gap: 7, minWidth: 155, justifyContent: "center",
                transition: "all 0.2s ease",
                ...(isSaved ? { background: "rgba(34,197,94,0.12)", color: "var(--success)", border: "1px solid rgba(34,197,94,0.2)" } : {}),
            }}>
            {isSaving ? <><Loader2 size={13} className="animate-spin" />Guardando…</>
                : isSaved ? <><Check size={13} />¡Guardado!</>
                    : <><Save size={13} />{label}</>}
        </button>
    );
}

export default function SettingsPage() {
    const { organization, role } = useOrg();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState<string | null>(null);
    const [saved, setSaved] = useState<string | null>(null);
    const [error, setError] = useState("");
    const [apiKey, setApiKey] = useState("");
    const [showKey, setShowKey] = useState(false);
    const [provider, setProvider] = useState<WhatsAppProvider>("twilio");
    const [credentials, setCredentials] = useState<Record<string, string>>({});
    // Guided Meta fields (shown in the easy setup card)
    const [metaToken, setMetaToken] = useState("");
    const [metaPhoneId, setMetaPhoneId] = useState("");
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        (async () => {
            const data = await loadTenantSettings(organization.id);
            if (data) {
                setApiKey(data.openai_api_key);
                setProvider(data.whatsapp_provider);
                setCredentials(data.whatsapp_credentials);
                // Pre-fill guided Meta fields if already saved
                if (data.whatsapp_credentials?.access_token)
                    setMetaToken(data.whatsapp_credentials.access_token);
                if (data.whatsapp_credentials?.phone_number_id)
                    setMetaPhoneId(data.whatsapp_credentials.phone_number_id);
            }
            setLoading(false);
        })();
    }, [organization.id]);

    const saveSection = useCallback(async (section: string, payload: Parameters<typeof updateTenantSettings>[0]) => {
        setSaving(section); setError(""); setSaved(null);
        const result = await updateTenantSettings(payload);
        if (result.success) { setSaved(section); setTimeout(() => setSaved(null), 2500); }
        else setError(result.error || "Error guardando");
        setSaving(null);
    }, []);

    const webhookUrl = typeof window !== "undefined"
        ? `${window.location.origin}/api/webhook/${organization.id}`
        : `https://tu-dominio.com/api/webhook/${organization.id}`;

    const copyWebhook = () => { navigator.clipboard.writeText(webhookUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); };
    const setCredField = (key: string, value: string) => setCredentials((prev) => ({ ...prev, [key]: value }));
    const credFields = provider === "twilio" ? TWILIO_FIELDS : META_FIELDS;

    if (loading) {
        return (
            <div className="animate-in flex items-center justify-center" style={{ minHeight: "60vh" }}>
                <Loader2 size={22} className="animate-spin" style={{ color: "var(--text-muted)" }} />
            </div>
        );
    }

    return (
        <div className="animate-in">
            <div className="page-header">
                <div>
                    <h1 className="page-title">Configuración</h1>
                    <p className="page-subtitle">Conexiones técnicas — APIs y proveedores de mensajería</p>
                </div>
            </div>

            {error && (
                <div className="flex items-center gap-2 p-4 rounded-xl mb-5 text-sm"
                    style={{ background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.14)", color: "var(--danger)", maxWidth: 720 }}>
                    <AlertCircle size={14} />{error}
                </div>
            )}

            <div className="grid gap-4" style={{ maxWidth: 720 }}>
                <SectionCard icon={<Building2 size={16} />} title="Organización" subtitle="Datos generales de tu cuenta">
                    <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
                        <ReadOnlyField label="Nombre" value={organization.name} />
                        <ReadOnlyField label="Slug" value={organization.slug} />
                        <ReadOnlyField label="Tu Rol" badge={role} />
                        <ReadOnlyField label="ID" value={organization.id} mono />
                    </div>
                </SectionCard>

                <SectionCard icon={<Key size={16} />} title="API Key de OpenAI" subtitle="Tu clave se usa para que el bot responda con IA"
                    footer={<SaveButton label="Guardar API Key" section="apikey" saving={saving} saved={saved}
                        onClick={() => saveSection("apikey", { orgId: organization.id, openai_api_key: apiKey })} />}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">OpenAI API Key</label>
                        <div style={{ position: "relative" }}>
                            <input className="input" type={showKey ? "text" : "password"} value={apiKey}
                                onChange={(e) => setApiKey(e.target.value)} placeholder="Ingresa tu API Key de OpenAI" style={{ paddingRight: 44 }} />
                            <button type="button" onClick={() => setShowKey(!showKey)}
                                style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 4 }}>
                                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                            </button>
                        </div>
                        <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                            Obtén tu clave en{" "}
                            <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer"
                                style={{ color: "var(--text-secondary)", textDecoration: "underline" }}>platform.openai.com</a>
                        </p>
                    </div>
                </SectionCard>

                {/* ── Guided WhatsApp Business Setup ───────────────── */}
                <SectionCard
                    icon={<MessageCircle size={16} />}
                    title="Conecta tu WhatsApp Business"
                    subtitle="Sigue estos pasos para obtener tus credenciales de Meta Cloud API"
                    footer={
                        <SaveButton
                            label="Guardar Configuración"
                            section="whatsapp-meta"
                            saving={saving}
                            saved={saved}
                            onClick={() =>
                                saveSection("whatsapp-meta", {
                                    orgId: organization.id,
                                    whatsapp_provider: "meta",
                                    whatsapp_credentials: {
                                        ...credentials,
                                        access_token: metaToken,
                                        phone_number_id: metaPhoneId,
                                    },
                                })
                            }
                        />
                    }
                >
                    {/* Step-by-step instructions */}
                    <ol style={{
                        paddingLeft: "18px",
                        margin: "0 0 20px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "10px",
                        fontSize: "0.83rem",
                        color: "var(--text-secondary)",
                        lineHeight: 1.6,
                    }}>
                        <li>
                            <a
                                href="https://developers.facebook.com/"
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                    color: "#60a5fa",
                                    textDecoration: "underline",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "4px",
                                    fontWeight: 600,
                                }}
                            >
                                Haz clic aquí para ir a Meta for Developers y crear tu App
                                <ExternalLink size={12} />
                            </a>
                            {" — "}
                            Crea una App de tipo <strong>Business</strong>.
                        </li>
                        <li>
                            Dentro de tu App, ve a <strong>WhatsApp → API Setup</strong>.
                            Copia el <strong>Temporary Access Token</strong> (o genera uno permanente)
                            y el <strong>Phone Number ID</strong> del número asociado.
                        </li>
                        <li>
                            Pega esos valores en los campos de abajo y haz clic en
                            <strong> Guardar Configuración</strong>.
                        </li>
                    </ol>

                    <div className="grid gap-3">
                        <div className="form-group" style={{ marginBottom: 0 }}>
                            <label className="form-label">Token de Acceso (Access Token)</label>
                            <input
                                className="input"
                                type="password"
                                value={metaToken}
                                onChange={(e) => setMetaToken(e.target.value)}
                                placeholder="EAAGm0PX4ZCpsBAG..."
                            />
                            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                                Token permanente generado desde Meta for Developers.
                            </p>
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                            <label className="form-label">Identificador de Número de Teléfono (Phone Number ID)</label>
                            <input
                                className="input"
                                type="text"
                                value={metaPhoneId}
                                onChange={(e) => setMetaPhoneId(e.target.value)}
                                placeholder="123456789012345"
                            />
                            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                                ID numérico — no es tu número de teléfono.
                            </p>
                        </div>
                    </div>
                </SectionCard>

                {/* ── Advanced WhatsApp Provider Settings ───────────── */}
                <SectionCard icon={<Wifi size={16} />} title="Proveedor de WhatsApp (Avanzado)" subtitle="Elige tu proveedor y guarda las credenciales"
                    footer={<SaveButton label="Guardar WhatsApp" section="whatsapp" saving={saving} saved={saved}
                        onClick={() => saveSection("whatsapp", { orgId: organization.id, whatsapp_provider: provider, whatsapp_credentials: credentials })} />}>
                    {/* Provider toggle */}
                    <div className="flex gap-2 mb-5">
                        {([["twilio", "Twilio", <Phone size={13} key="p" />], ["meta", "Meta Cloud API", <MessageCircle size={13} key="m" />]] as const).map(([p, label, icon]) => (
                            <button key={p} onClick={() => setProvider(p as WhatsAppProvider)} style={{
                                flex: 1, padding: "10px 14px", borderRadius: "10px",
                                border: provider === p ? "1px solid rgba(59,130,246,0.4)" : "1px solid rgba(255,255,255,0.06)",
                                background: provider === p ? "rgba(59,130,246,0.07)" : "rgba(255,255,255,0.02)",
                                color: provider === p ? "#60a5fa" : "var(--text-muted)",
                                cursor: "pointer", transition: "all 0.15s ease",
                                fontWeight: provider === p ? 600 : 400, fontSize: "0.83rem",
                                display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
                            }}>
                                {icon}{label}
                            </button>
                        ))}
                    </div>
                    <div className="grid gap-3">
                        {credFields.map((f) => (
                            <div className="form-group" style={{ marginBottom: 0 }} key={f.key}>
                                <label className="form-label">{f.label}</label>
                                <input className="input" type="text" value={credentials[f.key] || ""}
                                    onChange={(e) => setCredField(f.key, e.target.value)} placeholder={f.placeholder} />
                            </div>
                        ))}
                    </div>
                </SectionCard>

                <SectionCard icon={<Settings size={16} />} title="Tu Webhook URL" subtitle="Pega esta URL en la configuración de tu proveedor de WhatsApp">
                    <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Webhook URL (solo lectura)</label>
                        <div style={{ position: "relative" }}>
                            <input className="input" value={webhookUrl} readOnly
                                style={{ paddingRight: 44, fontFamily: "monospace", fontSize: "0.78rem", cursor: "default" }} />
                            <button type="button" onClick={copyWebhook} title="Copiar al portapapeles"
                                style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: copied ? "var(--success)" : "var(--text-muted)", cursor: "pointer", padding: 4, transition: "color 0.2s ease" }}>
                                {copied ? <Check size={14} /> : <Copy size={14} />}
                            </button>
                        </div>
                        <p className="text-xs mt-2" style={{ color: "var(--text-muted)", lineHeight: 1.5 }}>
                            {provider === "twilio"
                                ? "En Twilio → Messaging → WhatsApp Senders → Pega esta URL como \"When a message comes in\"."
                                : "En Meta → App Dashboard → WhatsApp → Configuration → Callback URL → Pega esta URL."}
                        </p>
                    </div>
                </SectionCard>
            </div>
        </div>
    );
}
