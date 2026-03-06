"use client";

interface ReadOnlyFieldProps {
    label: string;
    value?: string;
    badge?: string;
    mono?: boolean;
}

export default function ReadOnlyField({ label, value, badge, mono }: ReadOnlyFieldProps) {
    return (
        <div className="form-group !mb-0">
            <label className="form-label">{label}</label>
            {badge ? (
                <span className="badge badge-active capitalize">{badge}</span>
            ) : (
                <input
                    className={`input opacity-60 cursor-default ${mono ? "text-[0.7rem] font-mono" : ""}`}
                    value={value || ""}
                    readOnly
                />
            )}
        </div>
    );
}
