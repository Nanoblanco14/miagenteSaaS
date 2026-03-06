"use client";
import { useState } from "react";
import { Key, Eye, EyeOff } from "lucide-react";
import SectionCard from "@/components/ui/SectionCard";
import SaveButton from "@/components/ui/SaveButton";

interface ApiKeySectionProps {
    apiKey: string;
    onApiKeyChange: (value: string) => void;
    saving: string | null;
    saved: string | null;
    onSave: () => void;
}

export default function ApiKeySection({ apiKey, onApiKeyChange, saving, saved, onSave }: ApiKeySectionProps) {
    const [showKey, setShowKey] = useState(false);

    return (
        <SectionCard
            icon={<Key size={16} />}
            title="API Key de OpenAI"
            subtitle="Tu clave se usa para que el bot responda con IA"
            footer={
                <SaveButton
                    label="Guardar API Key"
                    section="apikey"
                    saving={saving}
                    saved={saved}
                    onClick={onSave}
                />
            }
        >
            <div className="form-group !mb-0">
                <label className="form-label">OpenAI API Key</label>
                <div className="relative">
                    <input
                        className="input pr-11"
                        type={showKey ? "text" : "password"}
                        value={apiKey}
                        onChange={(e) => onApiKeyChange(e.target.value)}
                        placeholder="Ingresa tu API Key de OpenAI"
                    />
                    <button
                        type="button"
                        onClick={() => setShowKey(!showKey)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 bg-transparent border-none text-[var(--text-muted)] cursor-pointer p-1"
                    >
                        {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                </div>
                <p className="text-xs mt-1 text-[var(--text-muted)]">
                    Obtén tu clave en{" "}
                    <a
                        href="https://platform.openai.com/api-keys"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[var(--text-secondary)] underline"
                    >
                        platform.openai.com
                    </a>
                </p>
            </div>
        </SectionCard>
    );
}
