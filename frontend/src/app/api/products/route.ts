import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { generateEmbedding, buildProductText } from "@/lib/openai";
import type { ProductCreate } from "@/lib/types";

// ── GET /api/products?org_id=xxx ───────────────────────────
export async function GET(req: NextRequest) {
    try {
        const orgId = req.nextUrl.searchParams.get("org_id");
        if (!orgId) return NextResponse.json({ error: "org_id required" }, { status: 400 });

        const db = getSupabaseAdmin();
        const { data, error } = await db
            .from("products")
            .select("*, product_files(*)")
            .eq("organization_id", orgId)
            .order("created_at", { ascending: false });

        if (error) throw error;
        return NextResponse.json({ data });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

// ── POST /api/products ─────────────────────────────────────
export async function POST(req: NextRequest) {
    try {
        const body: ProductCreate = await req.json();
        const { organization_id, name, description, attributes } = body;

        if (!organization_id || !name) {
            return NextResponse.json({ error: "organization_id and name required" }, { status: 400 });
        }

        // 1. Generate embedding from product text
        const productText = buildProductText({ name, description: description || "", attributes: attributes || {} });
        let embedding: number[] | null = null;
        try {
            embedding = await generateEmbedding(productText);
        } catch (e) {
            console.error("Embedding generation failed (product will be saved without embedding):", e);
        }

        // 2. Insert product with embedding
        const db = getSupabaseAdmin();
        const insertData: Record<string, unknown> = {
            organization_id,
            name,
            description: description || "",
            attributes: attributes || {},
        };
        if (embedding) {
            insertData.embedding = JSON.stringify(embedding);
        }

        const { data, error } = await db
            .from("products")
            .insert(insertData)
            .select()
            .single();

        if (error) throw error;
        return NextResponse.json({ data }, { status: 201 });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
