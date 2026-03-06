import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { authenticateRequest, verifyOrgAccess, apiError, serverError } from "@/lib/api-auth";

// ── POST /api/pipeline/stages ─────────────────────────────
// Create a new pipeline stage
export async function POST(req: NextRequest) {
    try {
        const result = await authenticateRequest("stages:POST");
        if ("error" in result) return result.error;
        const { auth } = result;

        const body = await req.json();
        const { organization_id, name, color, position } = body;

        if (!organization_id || !name) {
            return apiError("organization_id and name are required", 400, "MISSING_FIELDS");
        }

        const orgCheck = verifyOrgAccess(auth, organization_id);
        if (orgCheck) return orgCheck;

        const db = getSupabaseAdmin();

        // If no position given, put it at the end
        let pos = position;
        if (pos === undefined || pos === null) {
            const { data: maxStage } = await db
                .from("pipeline_stages")
                .select("position")
                .eq("organization_id", organization_id)
                .order("position", { ascending: false })
                .limit(1);
            pos = (maxStage?.[0]?.position ?? -1) + 1;
        }

        const { data, error } = await db
            .from("pipeline_stages")
            .insert({
                organization_id,
                name,
                color: color || null,
                position: pos,
            })
            .select()
            .single();

        if (error) throw error;
        return NextResponse.json({ data }, { status: 201 });
    } catch (err) {
        return serverError(err, "stages:POST");
    }
}

// ── PUT /api/pipeline/stages ──────────────────────────────
// Batch reorder stages: receives [{ id, position }]
export async function PUT(req: NextRequest) {
    try {
        const result = await authenticateRequest("stages:PUT");
        if ("error" in result) return result.error;

        const body = await req.json();
        const { stages } = body; // [{ id, position }]

        if (!Array.isArray(stages) || stages.length === 0) {
            return apiError("stages array is required", 400, "MISSING_FIELDS");
        }

        const db = getSupabaseAdmin();

        // Update each stage position
        for (const s of stages) {
            const { error } = await db
                .from("pipeline_stages")
                .update({ position: s.position })
                .eq("id", s.id);
            if (error) throw error;
        }

        return NextResponse.json({ success: true });
    } catch (err) {
        return serverError(err, "stages:PUT");
    }
}
