import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { authenticateRequest, verifyOrgAccess, apiError, serverError } from "@/lib/api-auth";

// ── GET /api/analytics?org_id=xxx ─────────────────────────
export async function GET(req: NextRequest) {
    try {
        const result = await authenticateRequest("analytics:GET");
        if ("error" in result) return result.error;
        const { auth } = result;

        const orgId = req.nextUrl.searchParams.get("org_id");
        if (!orgId) return apiError("org_id required", 400, "MISSING_PARAM");

        const orgCheck = verifyOrgAccess(auth, orgId);
        if (orgCheck) return orgCheck;

        const db = getSupabaseAdmin();

        // Fetch all leads for this org
        const { data: leads, error: leadsError } = await db
            .from("leads")
            .select("id, stage_id, appointment_date, source, created_at")
            .eq("organization_id", orgId);
        if (leadsError) throw leadsError;

        // Fetch all stages for this org (ordered by position)
        const { data: stages, error: stagesError } = await db
            .from("pipeline_stages")
            .select("id, name, color, position")
            .eq("organization_id", orgId)
            .order("position", { ascending: true });
        if (stagesError) throw stagesError;

        // Fetch AI-sent messages count from lead_messages
        const leadIds = (leads || []).map((l) => l.id);
        let aiMessages = 0;
        if (leadIds.length > 0) {
            const { count, error: msgError } = await db
                .from("lead_messages")
                .select("id", { count: "exact", head: true })
                .eq("role", "assistant")
                .in("lead_id", leadIds);
            if (!msgError) aiMessages = count ?? 0;
        }

        const allLeads = leads || [];
        const allStages = stages || [];

        // ── KPI Calculations ───────────────────────────────────
        const totalLeads = allLeads.length;

        const appointmentKeywords = ["visita", "cita", "agendad", "reuni", "appointment"];
        const appointmentStageIds = new Set(
            allStages
                .filter((s) =>
                    appointmentKeywords.some((k) => s.name.toLowerCase().includes(k))
                )
                .map((s) => s.id)
        );
        const citasAgendadas = allLeads.filter((l) =>
            appointmentStageIds.has(l.stage_id)
        ).length;

        const lastStage = allStages.length > 0 ? allStages[allStages.length - 1] : null;
        const successfulLeads = lastStage
            ? allLeads.filter((l) => l.stage_id === lastStage.id).length
            : 0;
        const lastStageName = lastStage?.name ?? "Etapa final";

        const discardedStageIds = new Set(
            allStages
                .filter((s) =>
                    s.name.toLowerCase().includes("descart") ||
                    s.name.toLowerCase().includes("cancelad") ||
                    s.name.toLowerCase().includes("no asist")
                )
                .map((s) => s.id)
        );
        const discardedLeads = allLeads.filter((l) =>
            discardedStageIds.has(l.stage_id)
        ).length;

        const conversionRate =
            totalLeads > 0
                ? Math.round((citasAgendadas / totalLeads) * 100 * 10) / 10
                : 0;

        const timeSavedMinutes = allLeads.length * 15;
        const timeSavedHours = Math.round((timeSavedMinutes / 60) * 10) / 10;

        const leadsByStage = allStages.map((stage) => ({
            stage_id: stage.id,
            stage_name: stage.name,
            color: stage.color || null,
            count: allLeads.filter((l) => l.stage_id === stage.id).length,
        }));

        const sourceMap: Record<string, number> = {};
        allLeads.forEach((l) => {
            const src = l.source || "manual";
            sourceMap[src] = (sourceMap[src] || 0) + 1;
        });
        const leadsBySource = Object.entries(sourceMap).map(([source, count]) => ({
            source,
            count,
        }));

        return NextResponse.json({
            data: {
                totalLeads,
                citasAgendadas,
                successfulLeads,
                lastStageName,
                discardedLeads,
                conversionRate,
                aiMessages,
                timeSavedMinutes,
                timeSavedHours,
                leadsByStage,
                leadsBySource,
            },
        });
    } catch (err) {
        return serverError(err, "analytics:GET");
    }
}
