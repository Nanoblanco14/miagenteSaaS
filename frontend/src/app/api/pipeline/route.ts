import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { authenticateRequest, verifyOrgAccess, apiError, serverError } from "@/lib/api-auth";

// ── GET /api/pipeline?org_id=xxx ───────────────────────────
// Returns all stages (ordered by position) with their leads
export async function GET(req: NextRequest) {
    try {
        const result = await authenticateRequest("pipeline:GET");
        if ("error" in result) return result.error;
        const { auth } = result;

        const orgId = req.nextUrl.searchParams.get("org_id");
        if (!orgId) return apiError("org_id required", 400, "MISSING_PARAM");

        const orgCheck = verifyOrgAccess(auth, orgId);
        if (orgCheck) return orgCheck;

        const db = getSupabaseAdmin();

        // Fetch stages ordered by position
        const { data: stages, error: stagesError } = await db
            .from("pipeline_stages")
            .select("*")
            .eq("organization_id", orgId)
            .order("position", { ascending: true });

        if (stagesError) throw stagesError;

        // Fetch all leads for this org
        const { data: leads, error: leadsError } = await db
            .from("leads")
            .select("*")
            .eq("organization_id", orgId)
            .order("created_at", { ascending: true });

        if (leadsError) throw leadsError;

        // Group leads into their stages
        const pipeline = (stages || []).map((stage: any) => ({
            ...stage,
            leads: (leads || []).filter((l: any) => l.stage_id === stage.id),
        }));

        return NextResponse.json({ data: pipeline });
    } catch (err) {
        return serverError(err, "pipeline:GET");
    }
}
