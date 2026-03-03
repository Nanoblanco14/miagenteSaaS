"use server";
import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * Scrapes plain text from a URL and saves it to agents.scraped_context.
 * No extra dependencies — strips HTML with a regex.
 */
export async function scrapeAndSaveUrl(
    agentId: string,
    url: string
): Promise<{ ok: boolean; preview?: string; error?: string }> {
    if (!agentId || !url) {
        return { ok: false, error: "Faltan parámetros" };
    }

    let rawHtml: string;
    try {
        const res = await fetch(url, {
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (compatible; KnowledgeBot/1.0; +https://antigravity.google)",
                Accept: "text/html,application/xhtml+xml",
            },
            signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
            return { ok: false, error: `HTTP ${res.status} al acceder a la URL` };
        }
        rawHtml = await res.text();
    } catch (err: any) {
        return { ok: false, error: `No se pudo acceder a la URL: ${err.message}` };
    }

    // ── Strip HTML ────────────────────────────────────────────
    // Remove <script>, <style>, <head> and all other tags
    let text = rawHtml
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<head[\s\S]*?<\/head>/gi, " ")
        .replace(/<[^>]+>/g, " ")          // strip remaining tags
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#039;/gi, "'")
        .replace(/\s+/g, " ")              // collapse whitespace
        .trim();

    // Truncate to avoid bloating the system prompt
    if (text.length > 8000) {
        text = text.slice(0, 8000) + "\n[...contenido truncado...]";
    }

    if (!text || text.length < 50) {
        return { ok: false, error: "No se pudo extraer texto útil de esa URL." };
    }

    // ── Persist to DB ─────────────────────────────────────────
    const db = getSupabaseAdmin();
    const { error: dbErr } = await db
        .from("agents")
        .update({ scraped_context: text })
        .eq("id", agentId);

    if (dbErr) {
        return { ok: false, error: `Error al guardar: ${dbErr.message}` };
    }

    return { ok: true, preview: text.slice(0, 240) };
}
