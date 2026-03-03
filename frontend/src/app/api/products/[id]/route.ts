import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { generateEmbedding, buildProductText } from "@/lib/openai";
import type { ProductUpdate } from "@/lib/types";

// ── PUT /api/products/[id] ─────────────────────────────────
export async function PUT(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const body: ProductUpdate = await req.json();

        const db = getSupabaseAdmin();

        // Build update payload
        const updateData: Record<string, unknown> = {};
        if (body.name !== undefined) updateData.name = body.name;
        if (body.description !== undefined) updateData.description = body.description;
        if (body.attributes !== undefined) updateData.attributes = body.attributes;

        // Regenerate embedding if content changed
        if (body.name !== undefined || body.description !== undefined || body.attributes !== undefined) {
            // Fetch current product to merge with updates
            const { data: current } = await db.from("products").select("name, description, attributes").eq("id", id).single();
            if (current) {
                const merged = {
                    name: body.name ?? current.name,
                    description: body.description ?? current.description,
                    attributes: body.attributes ?? current.attributes,
                };
                const productText = buildProductText(merged);
                try {
                    const embedding = await generateEmbedding(productText);
                    updateData.embedding = JSON.stringify(embedding);
                } catch (e) {
                    console.error("Embedding regeneration failed:", e);
                }
            }
        }

        const { data, error } = await db
            .from("products")
            .update(updateData)
            .eq("id", id)
            .select("*, product_files(*)")
            .single();

        if (error) throw error;
        return NextResponse.json({ data });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

// ── DELETE /api/products/[id] ──────────────────────────────
export async function DELETE(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const db = getSupabaseAdmin();

        const { error } = await db.from("products").delete().eq("id", id);
        if (error) throw error;

        return NextResponse.json({ success: true });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
