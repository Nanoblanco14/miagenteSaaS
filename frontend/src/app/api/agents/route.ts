import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { AgentCreate } from "@/lib/types";

// ── GET /api/agents?org_id=xxx ─────────────────────────────
export async function GET(req: NextRequest) {
    try {
        const orgId = req.nextUrl.searchParams.get("org_id");
        if (!orgId) return NextResponse.json({ error: "org_id required" }, { status: 400 });

        const db = getSupabaseAdmin();
        const { data, error } = await db
            .from("agents")
            .select("*")
            .eq("organization_id", orgId)
            .order("created_at", { ascending: false });

        if (error) throw error;
        return NextResponse.json({ data });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

// ── POST /api/agents ───────────────────────────────────────
export async function POST(req: NextRequest) {
    try {
        const body: AgentCreate = await req.json();
        if (!body.organization_id || !body.name) {
            return NextResponse.json({ error: "organization_id and name required" }, { status: 400 });
        }

        const db = getSupabaseAdmin();
        const { data, error } = await db
            .from("agents")
            .insert({
                organization_id: body.organization_id,
                name: body.name,
                system_prompt: body.system_prompt || "",
                personality: body.personality || "professional",
                language: body.language || "es",
                temperature: body.temperature ?? 0.7,
                max_tokens: body.max_tokens ?? 1024,
                welcome_message: body.welcome_message || "¡Hola! ¿En qué puedo ayudarte?",
                whatsapp_config: body.whatsapp_config || {},
            })
            .select()
            .single();

        if (error) throw error;
        return NextResponse.json({ data }, { status: 201 });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
