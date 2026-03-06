import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { apiError, serverError } from "@/lib/api-auth";

// ── POST /api/auth/setup ───────────────────────────────────
// Called after Supabase signUp to create org + membership.
// Special case: user is authenticated but has NO org yet,
// so we can't use authenticateRequest (it requires org membership).
export async function POST(req: NextRequest) {
    try {
        // Verify the user has a valid Supabase session
        const cookieStore = await cookies();
        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                cookies: {
                    getAll() { return cookieStore.getAll(); },
                    setAll() { /* read-only in API routes */ },
                },
            }
        );

        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError || !user) {
            return apiError("No autenticado", 401, "AUTH_REQUIRED");
        }

        const { user_id, org_name } = await req.json();
        if (!user_id || !org_name) {
            return apiError("user_id and org_name required", 400, "MISSING_FIELDS");
        }

        // Ensure the authenticated user matches the user_id in the request
        if (user.id !== user_id) {
            return apiError("user_id no coincide con la sesión", 403, "FORBIDDEN");
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
    } catch (err) {
        return serverError(err, "auth:setup");
    }
}
