import OpenAI from "openai";
import type { Product, ProductAttributes, SearchResult } from "./types";

// ── Singleton ──────────────────────────────────────────────
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Embedding Generation ───────────────────────────────────

/**
 * Generates a 1536-dim embedding vector for the given text.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
    const response = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: text.slice(0, 8000), // token safety
    });
    return response.data[0].embedding;
}

/**
 * Builds a rich text representation of a product for embedding.
 * Concatenates name + description + all JSONB attributes as readable text.
 */
export function buildProductText(product: {
    name: string;
    description: string;
    attributes: ProductAttributes;
}): string {
    const parts: string[] = [product.name];

    if (product.description) {
        parts.push(product.description);
    }

    // Flatten JSONB attributes into readable "key: value" lines
    const attrEntries = Object.entries(product.attributes);
    if (attrEntries.length > 0) {
        const attrText = attrEntries
            .map(([key, value]) => `${key}: ${value}`)
            .join(". ");
        parts.push(attrText);
    }

    return parts.join(". ");
}

// ── Chat Completion (Agent Response) ───────────────────────

export async function generateAgentResponse(params: {
    systemPrompt: string;
    context: SearchResult[];
    history: { role: "user" | "assistant"; content: string }[];
    userMessage: string;
    temperature?: number;
    maxTokens?: number;
}): Promise<string> {
    const { systemPrompt, context, history, userMessage, temperature = 0.7, maxTokens = 1024 } = params;

    // Build context block from search results
    let contextBlock = "";
    if (context.length > 0) {
        contextBlock = "\n\n---\nPRODUCTOS RELEVANTES:\n" +
            context.map((p, i) => {
                const attrs = Object.entries(p.attributes)
                    .map(([k, v]) => `  - ${k}: ${v}`)
                    .join("\n");
                return `${i + 1}. ${p.name} (relevancia: ${(p.similarity * 100).toFixed(0)}%)\n   ${p.description}\n${attrs}`;
            }).join("\n\n");
    }

    const messages: OpenAI.ChatCompletionMessageParam[] = [
        {
            role: "system" as const,
            content: systemPrompt + contextBlock +
                "\n\nINSTRUCCIONES: Responde de forma natural y útil. Si mencionas productos, usa SOLO la información proporcionada. Si no tienes información relevante, dilo honestamente.",
        },
        ...history.slice(-20).map(m => ({
            role: m.role as "user" | "assistant",
            content: m.content,
        })),
        { role: "user" as const, content: userMessage },
    ];

    const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
        temperature,
        max_tokens: maxTokens,
    });

    return response.choices[0]?.message?.content || "Lo siento, no pude generar una respuesta.";
}
