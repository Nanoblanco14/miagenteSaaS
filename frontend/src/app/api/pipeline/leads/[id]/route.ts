import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { authenticateRequest, apiError, serverError } from "@/lib/api-auth";

// ── PUT /api/pipeline/leads/[id] ──────────────────────────
// Update a lead (stage, name, phone, notes)
export async function PUT(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const result = await authenticateRequest("leads:PUT");
        if ("error" in result) return result.error;
        const { auth } = result;

        const { id } = await params;
        const body = await req.json();
        const db = getSupabaseAdmin();

        // Verify the lead belongs to the user's org
        const { data: existing } = await db
            .from("leads")
            .select("organization_id")
            .eq("id", id)
            .single();

        if (!existing || existing.organization_id !== auth.orgId) {
            return apiError("Lead no encontrado", 404, "NOT_FOUND");
        }

        // Build dynamic update payload
        const updatePayload: Record<string, unknown> = {};
        if (body.stage_id) updatePayload.stage_id = body.stage_id;
        if (body.name !== undefined) updatePayload.name = body.name;
        if (body.phone !== undefined) updatePayload.phone = body.phone;
        if (body.notes !== undefined) updatePayload.notes = body.notes;
        if (body.budget !== undefined) updatePayload.budget = body.budget;
        if (body.appointment_date !== undefined) updatePayload.appointment_date = body.appointment_date;
        if (body.source !== undefined) updatePayload.source = body.source;
        if (body.is_bot_paused !== undefined) updatePayload.is_bot_paused = body.is_bot_paused;

        if (Object.keys(updatePayload).length === 0) {
            return apiError("No fields to update", 400, "EMPTY_UPDATE");
        }

        const { data, error } = await db
            .from("leads")
            .update(updatePayload)
            .eq("id", id)
            .select()
            .single();

        if (error) throw error;
        return NextResponse.json({ data });
    } catch (err) {
        return serverError(err, "leads:PUT");
    }
}

// ── DELETE /api/pipeline/leads/[id] ───────────────────────
// Permanently removes a lead from the pipeline
export async function DELETE(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const result = await authenticateRequest("leads:DELETE");
        if ("error" in result) return result.error;
        const { auth } = result;

        const { id } = await params;
        const db = getSupabaseAdmin();

        // Verify the lead belongs to the user's org
        const { data: existing } = await db
            .from("leads")
            .select("organization_id")
            .eq("id", id)
            .single();

        if (!existing || existing.organization_id !== auth.orgId) {
            return apiError("Lead no encontrado", 404, "NOT_FOUND");
        }

        const { error } = await db.from("leads").delete().eq("id", id);
        if (error) throw error;
        return NextResponse.json({ success: true });
    } catch (err) {
        return serverError(err, "leads:DELETE");
    }
}
