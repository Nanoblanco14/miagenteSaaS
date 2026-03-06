"use client";
import { Loader2, Check, Save } from "lucide-react";

interface SaveButtonProps {
    label: string;
    section: string;
    saving: string | null;
    saved: string | null;
    onClick: () => void;
}

export default function SaveButton({ label, section, saving, saved, onClick }: SaveButtonProps) {
    const isSaving = saving === section;
    const isSaved = saved === section;

    return (
        <button
            className={`btn-primary flex items-center gap-[7px] min-w-[155px] justify-center transition-all duration-200 ${
                isSaved ? "!bg-green-500/10 !text-[var(--success)] !border !border-green-500/20" : ""
            }`}
            onClick={onClick}
            disabled={isSaving}
        >
            {isSaving ? (
                <><Loader2 size={13} className="animate-spin" />Guardando…</>
            ) : isSaved ? (
                <><Check size={13} />¡Guardado!</>
            ) : (
                <><Save size={13} />{label}</>
            )}
        </button>
    );
}
