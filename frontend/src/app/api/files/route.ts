import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { authenticateRequest, apiError, serverError } from "@/lib/api-auth";

const BUCKET = "documents";

// ── POST /api/files — Upload file to Supabase Storage + save record ──
export async function POST(req: NextRequest) {
    try {
        const result = await authenticateRequest("files:POST");
        if ("error" in result) return result.error;
        const { auth } = result;

        const formData = await req.formData();
        const file = formData.get("file") as File | null;
        const productId = formData.get("product_id") as string | null;
        const fileType = (formData.get("file_type") as string) || "document";

        if (!file || !productId) {
            return apiError("file and product_id required", 400, "MISSING_FIELDS");
        }

        const db = getSupabaseAdmin();

        // Verify the product belongs to the user's org
        const { data: product } = await db
            .from("products")
            .select("organization_id")
            .eq("id", productId)
            .single();

        if (!product || product.organization_id !== auth.orgId) {
            return apiError("Producto no encontrado", 404, "NOT_FOUND");
        }

        // Build a unique path: products/{product_id}/{timestamp}_{filename}
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `products/${productId}/${Date.now()}_${safeName}`;

        // Upload to Supabase Storage
        const buffer = Buffer.from(await file.arrayBuffer());
        const { error: uploadError } = await db.storage
            .from(BUCKET)
            .upload(path, buffer, {
                contentType: file.type,
                upsert: false,
            });

        if (uploadError) throw uploadError;

        // Get public URL
        const { data: urlData } = db.storage.from(BUCKET).getPublicUrl(path);
        const fileUrl = urlData.publicUrl;

        // Save record in product_files table
        const { data: record, error: dbError } = await db
            .from("product_files")
            .insert({
                product_id: productId,
                file_type: fileType,
                file_url: fileUrl,
                file_name: file.name,
                file_size: file.size,
            })
            .select()
            .single();

        if (dbError) throw dbError;

        return NextResponse.json({ data: record }, { status: 201 });
    } catch (err) {
        return serverError(err, "files:POST");
    }
}

// ── DELETE /api/files?id=xxx — Remove file from Storage + DB ──
export async function DELETE(req: NextRequest) {
    try {
        const result = await authenticateRequest("files:DELETE");
        if ("error" in result) return result.error;
        const { auth } = result;

        const fileId = req.nextUrl.searchParams.get("id");
        if (!fileId) return apiError("id required", 400, "MISSING_PARAM");

        const db = getSupabaseAdmin();

        // Fetch the file record and verify ownership via product
        const { data: record } = await db
            .from("product_files")
            .select("file_url, product_id")
            .eq("id", fileId)
            .single();

        if (record) {
            // Verify product belongs to user's org
            const { data: product } = await db
                .from("products")
                .select("organization_id")
                .eq("id", record.product_id)
                .single();

            if (!product || product.organization_id !== auth.orgId) {
                return apiError("Archivo no encontrado", 404, "NOT_FOUND");
            }

            if (record.file_url) {
                // Extract storage path from URL
                const url = new URL(record.file_url);
                const storagePath = url.pathname.split(`/object/public/${BUCKET}/`)[1];
                if (storagePath) {
                    await db.storage.from(BUCKET).remove([decodeURIComponent(storagePath)]);
                }
            }
        }

        // Delete DB record
        const { error } = await db.from("product_files").delete().eq("id", fileId);
        if (error) throw error;

        return NextResponse.json({ success: true });
    } catch (err) {
        return serverError(err, "files:DELETE");
    }
}
