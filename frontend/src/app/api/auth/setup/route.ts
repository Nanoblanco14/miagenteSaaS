import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

// ── POST /api/auth/setup ───────────────────────────────────
// Called after Supabase signUp to create org + membership
export async function POST(req: NextRequest) {
    try {
        const { user_id, org_name } = await req.json();
        if (!user_id || !org_name) {
            return NextResponse.json({ error: "user_id and org_name required" }, { status: 400 });
        }

        const db = getSupabaseAdmin();

        // Create organization
        const slug = org_name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
            + "-" + Date.now().toString(36);

        const { data: org, error: orgError } = await db
            .from("organizations")
            .insert({ name: org_name, slug })
            .select()
            .single();

        if (orgError) throw orgError;

        // Create membership (owner role)
        const { error: memberError } = await db
            .from("org_members")
            .insert({
                organization_id: org.id,
                user_id,
                role: "owner",
            });

        if (memberError) throw memberError;

        return NextResponse.json({ data: org }, { status: 201 });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
