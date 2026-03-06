import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { authenticateRequest, verifyOrgAccess, apiError, serverError } from "@/lib/api-auth";
import type { LeadCreate } from "@/lib/types";

// ── POST /api/pipeline/leads ──────────────────────────────
// Create a new lead
export async function POST(req: NextRequest) {
    try {
        const result = await authenticateRequest("leads:POST");
        if ("error" in result) return result.error;
        const { auth } = result;

        const body: LeadCreate = await req.json();

        if (!body.organization_id || !body.stage_id || !body.name) {
            return apiError("organization_id, stage_id, and name are required", 400, "MISSING_FIELDS");
        }

        const orgCheck = verifyOrgAccess(auth, body.organization_id);
        if (orgCheck) return orgCheck;

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
    } catch (err) {
        return serverError(err, "leads:POST");
    }
}
