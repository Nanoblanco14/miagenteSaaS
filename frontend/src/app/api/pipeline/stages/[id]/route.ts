import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { authenticateRequest, apiError, serverError } from "@/lib/api-auth";

// ── PUT /api/pipeline/stages/:id ──────────────────────────
// Update a single stage (name, color)
export async function PUT(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const result = await authenticateRequest("stages:PUT");
        if ("error" in result) return result.error;
        const { auth } = result;

        const { id } = await params;
        const body = await req.json();
        const updates: Record<string, unknown> = {};

        if (body.name !== undefined) updates.name = body.name;
        if (body.color !== undefined) updates.color = body.color;
        if (body.position !== undefined) updates.position = body.position;

        if (Object.keys(updates).length === 0) {
            return apiError("Nothing to update", 400, "EMPTY_UPDATE");
        }

        const db = getSupabaseAdmin();

        // Verify the stage belongs to the user's org
        const { data: existing } = await db
            .from("pipeline_stages")
            .select("organization_id")
            .eq("id", id)
            .single();

        if (!existing || existing.organization_id !== auth.orgId) {
            return apiError("Etapa no encontrada", 404, "NOT_FOUND");
        }

        const { data, error } = await db
            .from("pipeline_stages")
            .update(updates)
            .eq("id", id)
            .select()
            .single();

        if (error) throw error;
        return NextResponse.json({ data });
    } catch (err) {
        return serverError(err, "stages:PUT");
    }
}

// ── DELETE /api/pipeline/stages/:id ───────────────────────
// Delete a stage (only if it has no leads)
export async function DELETE(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const result = await authenticateRequest("stages:DELETE");
        if ("error" in result) return result.error;
        const { auth } = result;

        const { id } = await params;
        const db = getSupabaseAdmin();

        // Verify the stage belongs to the user's org
        const { data: existing } = await db
            .from("pipeline_stages")
            .select("organization_id")
            .eq("id", id)
            .single();

        if (!existing || existing.organization_id !== auth.orgId) {
            return apiError("Etapa no encontrada", 404, "NOT_FOUND");
        }

        // Check for leads in this stage
        const { data: leads, error: leadsError } = await db
            .from("leads")
            .select("id")
            .eq("stage_id", id)
            .limit(1);

        if (leadsError) throw leadsError;

        if (leads && leads.length > 0) {
            return apiError(
                "No puedes eliminar una etapa que tiene leads. Muévelos primero.",
                400,
                "STAGE_HAS_LEADS"
            );
        }

        const { error } = await db
            .from("pipeline_stages")
            .delete()
            .eq("id", id);

        if (error) throw error;
        return NextResponse.json({ success: true });
    } catch (err) {
        return serverError(err, "stages:DELETE");
    }
}
