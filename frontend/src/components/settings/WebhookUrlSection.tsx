"use client";
import { useState } from "react";
import { Settings, Check, Copy } from "lucide-react";
import SectionCard from "@/components/ui/SectionCard";

type WhatsAppProvider = "twilio" | "meta";

interface WebhookUrlSectionProps {
    webhookUrl: string;
    provider: WhatsAppProvider;
}

export default function WebhookUrlSection({ webhookUrl, provider }: WebhookUrlSectionProps) {
    const [copied, setCopied] = useState(false);

    const copyWebhook = () => {
        navigator.clipboard.writeText(webhookUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <SectionCard
            icon={<Settings size={16} />}
            title="Tu Webhook URL"
            subtitle="Pega esta URL en la configuración de tu proveedor de WhatsApp"
        >
            <div className="form-group !mb-0">
                <label className="form-label">Webhook URL (solo lectura)</label>
                <div className="relative">
                    <input
                        className="input pr-11 font-mono text-[0.78rem] cursor-default"
                        value={webhookUrl}
                        readOnly
                    />
                    <button
                        type="button"
                        onClick={copyWebhook}
                        title="Copiar al portapapeles"
                        className={`absolute right-2.5 top-1/2 -translate-y-1/2 bg-transparent border-none cursor-pointer p-1 transition-colors duration-200 ${
                            copied ? "text-[var(--success)]" : "text-[var(--text-muted)]"
                        }`}
                    >
                        {copied ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                </div>
                <p className="text-xs mt-2 text-[var(--text-muted)] leading-normal">
                    {provider === "twilio"
                        ? 'En Twilio → Messaging → WhatsApp Senders → Pega esta URL como "When a message comes in".'
                        : "En Meta → App Dashboard → WhatsApp → Configuration → Callback URL → Pega esta URL."}
                </p>
            </div>
        </SectionCard>
    );
}
