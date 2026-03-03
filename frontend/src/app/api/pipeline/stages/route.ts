import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

// ── POST /api/pipeline/stages ─────────────────────────────
// Create a new pipeline stage
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { organization_id, name, color, position } = body;

        if (!organization_id || !name) {
            return NextResponse.json(
                { error: "organization_id and name are required" },
                { status: 400 }
            );
        }

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
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

// ── PUT /api/pipeline/stages ──────────────────────────────
// Batch reorder stages: receives [{ id, position }]
export async function PUT(req: NextRequest) {
    try {
        const body = await req.json();
        const { stages } = body; // [{ id, position }]

        if (!Array.isArray(stages) || stages.length === 0) {
            return NextResponse.json(
                { error: "stages array is required" },
                { status: 400 }
            );
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
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
