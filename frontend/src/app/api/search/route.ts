import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { generateEmbedding } from "@/lib/openai";
import { authenticateRequest, verifyOrgAccess, apiError, serverError } from "@/lib/api-auth";
import type { SearchRequest, SearchResult } from "@/lib/types";

// ── POST /api/search ───────────────────────────────────────
// Semantic search: searchProducts(query, organization_id)
// Uses pgvector cosine similarity via the match_products RPC
export async function POST(req: NextRequest) {
    try {
        const result = await authenticateRequest("search:POST");
        if ("error" in result) return result.error;
        const { auth } = result;

        const body: SearchRequest = await req.json();
        const { query, organization_id, threshold = 0.5, limit = 10 } = body;

        if (!query || !organization_id) {
            return apiError("query and organization_id required", 400, "MISSING_FIELDS");
        }

        const orgCheck = verifyOrgAccess(auth, organization_id);
        if (orgCheck) return orgCheck;

        // 1. Generate embedding for the search query
        const queryEmbedding = await generateEmbedding(query);

        // 2. Call the match_products RPC function (cosine similarity, org-scoped)
        const db = getSupabaseAdmin();
        const { data, error } = await db.rpc("match_products", {
            query_embedding: JSON.stringify(queryEmbedding),
            match_org_id: organization_id,
            match_threshold: threshold,
            match_count: limit,
        });

        if (error) throw error;

        const results: SearchResult[] = (data || []).map((row: any) => ({
            id: row.id,
            name: row.name,
            description: row.description,
            attributes: row.attributes,
            similarity: row.similarity,
        }));

        return NextResponse.json({ data: results });
    } catch (err) {
        return serverError(err, "search:POST");
    }
}
