"use client";
import { MessageCircle, ExternalLink } from "lucide-react";
import SectionCard from "@/components/ui/SectionCard";
import SaveButton from "@/components/ui/SaveButton";

interface WhatsAppSetupSectionProps {
    metaToken: string;
    metaPhoneId: string;
    onMetaTokenChange: (value: string) => void;
    onMetaPhoneIdChange: (value: string) => void;
    saving: string | null;
    saved: string | null;
    onSave: () => void;
}

export default function WhatsAppSetupSection({
    metaToken, metaPhoneId, onMetaTokenChange, onMetaPhoneIdChange, saving, saved, onSave,
}: WhatsAppSetupSectionProps) {
    return (
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
                    onClick={onSave}
                />
            }
        >
            {/* Step-by-step instructions */}
            <ol className="pl-[18px] mb-5 flex flex-col gap-2.5 text-[0.83rem] text-[var(--text-secondary)] leading-relaxed">
                <li>
                    <a
                        href="https://developers.facebook.com/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 underline inline-flex items-center gap-1 font-semibold"
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
                <div className="form-group !mb-0">
                    <label className="form-label">Token de Acceso (Access Token)</label>
                    <input
                        className="input"
                        type="password"
                        value={metaToken}
                        onChange={(e) => onMetaTokenChange(e.target.value)}
                        placeholder="EAAGm0PX4ZCpsBAG..."
                    />
                    <p className="text-xs mt-1 text-[var(--text-muted)]">
                        Token permanente generado desde Meta for Developers.
                    </p>
                </div>
                <div className="form-group !mb-0">
                    <label className="form-label">Identificador de Número de Teléfono (Phone Number ID)</label>
                    <input
                        className="input"
                        type="text"
                        value={metaPhoneId}
                        onChange={(e) => onMetaPhoneIdChange(e.target.value)}
                        placeholder="123456789012345"
                    />
                    <p className="text-xs mt-1 text-[var(--text-muted)]">
                        ID numérico — no es tu número de teléfono.
                    </p>
                </div>
            </div>
        </SectionCard>
    );
}
