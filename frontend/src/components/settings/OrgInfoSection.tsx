"use client";
import { Building2 } from "lucide-react";
import SectionCard from "@/components/ui/SectionCard";
import ReadOnlyField from "@/components/ui/ReadOnlyField";
import type { Organization, OrgRole } from "@/lib/types";

interface OrgInfoSectionProps {
    organization: Organization;
    role: OrgRole;
}

export default function OrgInfoSection({ organization, role }: OrgInfoSectionProps) {
    return (
        <SectionCard
            icon={<Building2 size={16} />}
            title="Organización"
            subtitle="Datos generales de tu cuenta"
        >
            <div className="grid grid-cols-2 gap-4">
                <ReadOnlyField label="Nombre" value={organization.name} />
                <ReadOnlyField label="Slug" value={organization.slug} />
                <ReadOnlyField label="Tu Rol" badge={role} />
                <ReadOnlyField label="ID" value={organization.id} mono />
            </div>
        </SectionCard>
    );
}
