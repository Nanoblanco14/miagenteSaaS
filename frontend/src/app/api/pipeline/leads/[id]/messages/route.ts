import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

// ── GET /api/pipeline/leads/[id]/messages ─────────────────
// Returns all chat messages for a given lead, ordered ASC
export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const db = getSupabaseAdmin();

        const { data, error } = await db
            .from("lead_messages")
            .select("id, lead_id, role, content, created_at")
            .eq("lead_id", id)
            .order("created_at", { ascending: true });

        if (error) throw error;
        return NextResponse.json({ data: data ?? [] });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
