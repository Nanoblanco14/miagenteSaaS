import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { LeadCreate } from "@/lib/types";

// ── POST /api/pipeline/leads ──────────────────────────────
// Create a new lead
export async function POST(req: NextRequest) {
    try {
        const body: LeadCreate = await req.json();

        if (!body.organization_id || !body.stage_id || !body.name) {
            return NextResponse.json(
                { error: "organization_id, stage_id, and name are required" },
                { status: 400 }
            );
        }

        const db = getSupabaseAdmin();
        const { data, error } = await db
            .from("leads")
            .insert({
                organization_id: body.organization_id,
                stage_id: body.stage_id,
                name: body.name,
                email: body.email || "",
                phone: body.phone || "",
                budget: body.budget || "",
                appointment_date: body.appointment_date || "",
                source: body.source || "manual",
            })
            .select()
            .single();

        if (error) throw error;
        return NextResponse.json({ data }, { status: 201 });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
