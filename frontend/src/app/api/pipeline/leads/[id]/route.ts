import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

// ── PUT /api/pipeline/leads/[id] ──────────────────────────
// Update a lead (stage, name, phone, notes)
export async function PUT(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const body = await req.json();

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
            return NextResponse.json({ error: "No fields to update" }, { status: 400 });
        }

        const db = getSupabaseAdmin();
        const { data, error } = await db
            .from("leads")
            .update(updatePayload)
            .eq("id", id)
            .select()
            .single();

        if (error) throw error;
        return NextResponse.json({ data });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

// ── DELETE /api/pipeline/leads/[id] ───────────────────────
// Permanently removes a lead from the pipeline
export async function DELETE(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const db = getSupabaseAdmin();
        const { error } = await db.from("leads").delete().eq("id", id);
        if (error) throw error;
        return NextResponse.json({ success: true });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
