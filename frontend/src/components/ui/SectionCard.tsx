"use client";
import IconBox from "./IconBox";

interface SectionCardProps {
    icon: React.ReactNode;
    title: string;
    subtitle: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
}

export default function SectionCard({ icon, title, subtitle, children, footer }: SectionCardProps) {
    return (
        <div className="glass-card cursor-default">
            <div className="p-6">
                <div className="flex items-center gap-3 mb-5">
                    <IconBox>{icon}</IconBox>
                    <div>
                        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
                        <p className="text-xs text-[var(--text-muted)]">{subtitle}</p>
                    </div>
                </div>
                {children}
                {footer && <div className="mt-5 flex justify-end">{footer}</div>}
            </div>
        </div>
    );
}
