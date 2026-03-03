import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

// ── GET /api/pipeline?org_id=xxx ───────────────────────────
// Returns all stages (ordered by position) with their leads
export async function GET(req: NextRequest) {
    try {
        const orgId = req.nextUrl.searchParams.get("org_id");
        if (!orgId) return NextResponse.json({ error: "org_id required" }, { status: 400 });

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
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
