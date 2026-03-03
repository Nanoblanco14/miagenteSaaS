import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

// ── PUT /api/pipeline/stages/:id ──────────────────────────
// Update a single stage (name, color)
export async function PUT(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const body = await req.json();
        const updates: Record<string, unknown> = {};

        if (body.name !== undefined) updates.name = body.name;
        if (body.color !== undefined) updates.color = body.color;
        if (body.position !== undefined) updates.position = body.position;

        if (Object.keys(updates).length === 0) {
            return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
        }

        const db = getSupabaseAdmin();
        const { data, error } = await db
            .from("pipeline_stages")
            .update(updates)
            .eq("id", id)
            .select()
            .single();

        if (error) throw error;
        return NextResponse.json({ data });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

// ── DELETE /api/pipeline/stages/:id ───────────────────────
// Delete a stage (only if it has no leads)
export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const db = getSupabaseAdmin();

        // Check for leads in this stage
        const { data: leads, error: leadsError } = await db
            .from("leads")
            .select("id")
            .eq("stage_id", id)
            .limit(1);

        if (leadsError) throw leadsError;

        if (leads && leads.length > 0) {
            return NextResponse.json(
                { error: "No puedes eliminar una etapa que tiene leads. Muévelos primero." },
                { status: 400 }
            );
        }

        const { error } = await db
            .from("pipeline_stages")
            .delete()
            .eq("id", id);

        if (error) throw error;
        return NextResponse.json({ success: true });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
