// ═══════════════════════════════════════════════════════════════
// ⚠️ LEGACY — Webhook de Twilio/WhatsApp (single-tenant).
// Para multi-tenant usar: /api/webhook/[tenantId]
// ═══════════════════════════════════════════════════════════════
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";

// ── Clientes ────────────────────────────────────────────────
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Org ID desde variable de entorno (antes era hardcodeado) ─
const ORG_ID = process.env.DEFAULT_ORG_ID!;

// ── Memoria a corto plazo (por número de teléfono) ──────────
const chatMemory = new Map<string, ChatCompletionMessageParam[]>();

// ═══════════════════════════════════════════════════════════════
//  🔧 TOOL DEFINITION — gestionar_lead_crm
// ═══════════════════════════════════════════════════════════════
const tools: ChatCompletionTool[] = [
    {
        type: "function",
        function: {
            name: "gestionar_lead_crm",
            description:
                "Guarda o actualiza un lead en el CRM del pipeline de ventas. " +
                "Llama a esta función SIEMPRE que determines el estado final del prospecto " +
                "(Calificado con cita agendada, o Descartado).",
            parameters: {
                type: "object",
                properties: {
                    nombre_cliente: {
                        type: "string",
                        description: "Nombre del prospecto tal como lo proporcionó en la conversación.",
                    },
                    estado_filtro: {
                        type: "string",
                        enum: ["Calificado", "Descartado", "Derivado a Humano"],
                        description:
                            "Calificado = el prospecto cumple requisitos y agendó cita. " +
                            "Descartado = no califica, es turista sin intención real de compra. " +
                            "Derivado a Humano = prospecto evaluando el mercado, necesita atención humana especializada.",
                    },
                    fecha_hora_cita: {
                        type: "string",
                        description:
                            "Fecha y hora de la cita en formato ISO 8601 (ej: 2026-02-26T11:00:00). " +
                            "Obligatorio si estado_filtro es Calificado. Omitir si es Descartado.",
                    },
                    resumen_conversacion: {
                        type: "string",
                        description:
                            "Resumen breve con los datos clave extraídos: presupuesto, " +
                            "zona de interés, tipo de propiedad, motivo de descarte si aplica.",
                    },
                },
                required: ["nombre_cliente", "estado_filtro", "resumen_conversacion"],
            },
        },
    },
];

// ═══════════════════════════════════════════════════════════════
//  🧠 SYSTEM PROMPT — Cerebro del Agente de Ventas
// ═══════════════════════════════════════════════════════════════
//
// TODO [DYNAMIC PROMPT]: En el futuro, reemplazar este systemPrompt
// hardcodeado con una consulta dinámica por tenant:
//
//   1. Identificar el org_id del remitente usando su número de teléfono
//      (buscar en la tabla `leads` por phone, o crear una tabla `phone_org_mapping`)
//
//   2. Consultar el prompt personalizado:
//      SELECT system_prompt FROM agents
//      WHERE organization_id = orgId AND is_active = true
//      LIMIT 1
//
//   3. Usar ese system_prompt como contenido "system" en la llamada
//      a OpenAI (línea ~112: { role: "system", content: dynamicPrompt })
//
//   4. Fallback: si no hay agente configurado para ese tenant,
//      usar este prompt por defecto que está abajo.
//
//   La configuración del agente se gestiona desde:
//   → Frontend: /dashboard/agents (src/app/dashboard/agents/page.tsx)
//   → API: /api/agents & /api/agents/[id]
//   → Tabla Supabase: agents (campos: name, system_prompt, welcome_message, etc.)
//
function getSystemPrompt(): string {
    const now = new Date();
    const chileDate = now.toLocaleDateString('es-CL', { timeZone: 'America/Santiago', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const chileTime = now.toLocaleTimeString('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit' });
    const chileFull = now.toLocaleString('es-CL', { timeZone: 'America/Santiago' });

    return `
Eres un agente de ventas de IA avanzado. Tu misión principal es FILTRAR a los prospectos haciendo preguntas clave.

═══ FECHA Y HORA ACTUAL ═══
📅 Hoy es: ${chileDate}
⏰ Hora actual (Chile): ${chileTime}
🗓️ Timestamp completo: ${chileFull}
USA ESTA FECHA COMO REFERENCIA ABSOLUTA para cualquier cálculo de fechas.

═══ REGLAS DE MANEJO DE FECHAS ═══
⚠️ Si el cliente menciona un día relativo ("mañana", "el próximo lunes", "pasado mañana", "esta semana", "el viernes"), DEBES:
1. Calcular la fecha EXACTA basándote en la fecha actual de arriba.
2. CONFIRMAR la fecha exacta con el cliente ANTES de llamar a la herramienta. Ejemplo: "¿Te parece bien el lunes 24 de febrero a las 11:00?"
3. SOLO llama a gestionar_lead_crm DESPUÉS de que el cliente confirme la fecha exacta.
4. NUNCA uses años anteriores al actual. El año actual es ${now.getFullYear()}.

═══ REGLAS DE FORMATO DE RESPUESTA ═══
⚠️ PROHIBICIÓN ABSOLUTA: BAJO NINGUNA CIRCUNSTANCIA debes escribir JSON, código, llaves {}, corchetes [], ni estructuras de programación en tus respuestas de texto.
⚠️ Si necesitas agendar, descartar o derivar un prospecto, UTILIZA LA HERRAMIENTA gestionar_lead_crm de forma nativa (tool_calls). NUNCA escribas los argumentos de la herramienta en el chat.
⚠️ Tus respuestas deben ser EXCLUSIVAMENTE texto conversacional en español, como si hablaras por WhatsApp con un cliente.

═══ REGLAS DE FILTRADO ═══
1. Saluda cordialmente y pregunta su nombre.
2. Haz 2-3 preguntas filtro: ¿Qué tipo de propiedad busca? ¿En qué zona? ¿Cuál es su presupuesto?
3. Sé breve (máximo 2 párrafos por respuesta).
4. PREVENCIÓN DE ALUCINACIONES: NUNCA inventes propiedades, precios ni direcciones. Si no sabes algo, di: "Un asesor especialista puede darte esa información detallada."

═══ REGLA DE INTENCIÓN (Curiosos vs. Potenciales) ═══
Si el cliente dice que no tiene presupuesto, está curioseando o mirando, DEBES evaluar su intención real:

• TURISTA SIN INTENCIÓN: Si es alguien sin interés de compra a futuro (ej: "solo miro fotos por aburrimiento", "no me interesa comprar"), descártalo amablemente.
  → Llama a gestionar_lead_crm con estado_filtro = "Descartado".

• PROSPECTO EVALUANDO EL MERCADO: Si está evaluando opciones (ej: "quiero ver si me gusta la zona", "estudiando si comprar o arrendar", "aún no tengo presupuesto definido pero me interesa"), NO LO DESCARTES.
  → Dile amablemente: "Entiendo que estás evaluando opciones. Un especialista humano de nuestro equipo te contactará para asesorarte con opciones exploratorias. ¡Gracias por tu interés!"
  → Llama a gestionar_lead_crm con estado_filtro = "Derivado a Humano".

═══ PROSPECTO SÍ CALIFICA ═══
Si el prospecto tiene presupuesto, interés real y califica:
1. Ofrécele agendar una visita o llamada: "¡Excelente! Atendemos de Lunes a Viernes de 9:00 a 18:00 hrs. ¿Qué día y hora te acomoda?"
2. Cuando el cliente confirme día y hora, CONFIRMA la fecha exacta primero, luego LLAMA obligatoriamente a la función gestionar_lead_crm con estado_filtro = "Calificado" y la fecha_hora_cita en formato ISO.
3. Después de llamar a la función, despídete confirmando la cita.

═══ OBLIGACIÓN DE USO DE HERRAMIENTA ═══
🚨 OBLIGATORIO: Ya sea para agendar (Calificado), descartar (Descartado) o derivar a humano (Derivado a Humano), NUNCA te despidas sin usar la herramienta gestionar_lead_crm.
Si omites la herramienta, el sistema fallará y el cliente se perderá del CRM.
SIEMPRE llama a la función ANTES de tu mensaje de despedida.

═══ IMPORTANTE ═══
- El resumen_conversacion debe incluir: presupuesto mencionado, zona de interés, tipo de propiedad, motivo de derivación si aplica.
- REPITO: NO escribas JSON en tus mensajes. Usa SOLO la herramienta.
`;
}

// ═══════════════════════════════════════════════════════════════
//  📨 POST handler — Webhook de Twilio/WhatsApp
// ═══════════════════════════════════════════════════════════════
export async function POST(req: Request) {
    try {
        const formData = await req.formData();
        const incomingMsg = formData.get("Body")?.toString() || "";
        const sender = formData.get("From")?.toString() || "";
        const phoneClean = sender.replace("whatsapp:", "");

        console.log(`📩 WhatsApp de ${sender}: ${incomingMsg}`);

        // ── 1. Memoria a corto plazo ────────────────────────
        if (!chatMemory.has(sender)) {
            chatMemory.set(sender, []);
        }
        const history = chatMemory.get(sender)!;
        history.push({ role: "user", content: incomingMsg });

        // ── 1b. Micro-estado en vivo (Live Tracking) ────────
        const msgCount = history.filter((m) => m.role === "user").length;
        let liveChatStatus = "Contacto inicial";
        if (msgCount === 1) liveChatStatus = "Contacto inicial";
        else if (msgCount <= 3) liveChatStatus = "Consultando opciones";
        else liveChatStatus = "Filtrando perfil";

        // SELECT first — only update if exists, insert ONLY on first message
        const orgIdForStatus = ORG_ID;
        const { data: existingForStatus } = await supabase
            .from("leads")
            .select("id")
            .eq("organization_id", orgIdForStatus)
            .eq("phone", phoneClean)
            .limit(1);

        const leadAlreadyExists = existingForStatus && existingForStatus.length > 0;

        if (leadAlreadyExists) {
            // ALWAYS update — never insert a duplicate
            await supabase
                .from("leads")
                .update({ chat_status: liveChatStatus })
                .eq("id", existingForStatus[0].id);
        } else if (msgCount === 1) {
            // INSERT only on the VERY FIRST message when no lead exists
            const { data: firstStage } = await supabase
                .from("pipeline_stages")
                .select("id")
                .eq("organization_id", orgIdForStatus)
                .order("position", { ascending: true })
                .limit(1);

            await supabase.from("leads").insert({
                organization_id: orgIdForStatus,
                stage_id: firstStage?.[0]?.id || "",
                name: `Lead WhatsApp`,
                phone: phoneClean,
                source: "whatsapp",
                chat_status: liveChatStatus,
            });
        }
        // If msgCount > 1 and lead doesn't exist (edge case: memory but no DB row),
        // skip — the tool call block below will handle creation.

        // ── 2. Llamada a OpenAI CON Tools ───────────────────
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: getSystemPrompt() },
                ...history,
            ],
            tools,
            tool_choice: "auto",
        });

        const choice = completion.choices[0];
        const assistantMsg = choice.message;
        let botResponse = assistantMsg.content || "";

        // ── 3. ¿La IA pidió ejecutar una tool? ──────────────
        if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
            // Guardar el mensaje del assistant (con tool_calls) en el historial
            history.push(assistantMsg);

            for (const toolCall of assistantMsg.tool_calls) {
                if (toolCall.type !== "function") continue;
                if (toolCall.function.name === "gestionar_lead_crm") {
                    const args = JSON.parse(toolCall.function.arguments);
                    const {
                        nombre_cliente,
                        estado_filtro,
                        fecha_hora_cita,
                        resumen_conversacion,
                    } = args;

                    console.log(`🔧 Tool call: ${estado_filtro} — ${nombre_cliente}`);

                    // ── Procesar en Supabase ────────────────
                    const orgId = ORG_ID;

                    // Buscar el stage destino según el estado
                    let targetStageName = "";
                    if (estado_filtro === "Calificado") {
                        targetStageName = "isita"; // matches "Visita Agendada"
                    } else if (estado_filtro === "Descartado") {
                        targetStageName = "escart"; // matches "Descartado/Perdido"
                    } else if (estado_filtro === "Derivado a Humano") {
                        targetStageName = ""; // will use fallback: 2nd stage or 1st
                    }

                    const { data: matchedStages } = await supabase
                        .from("pipeline_stages")
                        .select("id")
                        .eq("organization_id", orgId)
                        .ilike("name", `%${targetStageName}%`)
                        .limit(1);

                    // Fallback: for "Derivado a Humano" use 2nd stage; otherwise 1st stage
                    let targetStageId = matchedStages?.[0]?.id;
                    if (!targetStageId) {
                        const { data: fallbackStages } = await supabase
                            .from("pipeline_stages")
                            .select("id")
                            .eq("organization_id", orgId)
                            .order("position", { ascending: true })
                            .limit(2);
                        if (estado_filtro === "Derivado a Humano" && fallbackStages && fallbackStages.length >= 2) {
                            targetStageId = fallbackStages[1].id; // 2nd column
                        } else {
                            targetStageId = fallbackStages?.[0]?.id;
                        }
                    }

                    // Buscar si ya existe un lead con este teléfono
                    const { data: existingLeads } = await supabase
                        .from("leads")
                        .select("id")
                        .eq("organization_id", orgId)
                        .eq("phone", phoneClean)
                        .limit(1);

                    const finalChatStatus =
                        estado_filtro === "Calificado"
                            ? (fecha_hora_cita ? "Cita agendada" : "Negociando horario")
                            : estado_filtro === "Derivado a Humano"
                                ? "Derivado a humano"
                                : "Descartado";

                    const leadPayload: Record<string, string> = {
                        name: nombre_cliente || `Lead WhatsApp`,
                        phone: phoneClean,
                        notes: resumen_conversacion || "",
                        source: "whatsapp",
                        stage_id: targetStageId || "",
                        chat_status: finalChatStatus,
                    };

                    if (estado_filtro === "Calificado" && fecha_hora_cita) {
                        leadPayload.appointment_date = fecha_hora_cita;
                    }

                    if (existingLeads && existingLeads.length > 0) {
                        // UPDATE existing lead
                        await supabase
                            .from("leads")
                            .update(leadPayload)
                            .eq("id", existingLeads[0].id);
                        console.log(`✅ Lead actualizado: ${nombre_cliente} → ${estado_filtro}`);
                    } else {
                        // INSERT new lead
                        await supabase
                            .from("leads")
                            .insert({
                                organization_id: orgId,
                                ...leadPayload,
                            });
                        console.log(`✅ Lead creado: ${nombre_cliente} → ${estado_filtro}`);
                    }

                    // ── 4. Webhook de salida (Make / Zapier) ──
                    const webhookUrl = process.env.MAKE_WEBHOOK_URL;
                    if (webhookUrl) {
                        try {
                            await fetch(webhookUrl, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                    event: "lead_updated",
                                    lead: {
                                        nombre: nombre_cliente,
                                        telefono: phoneClean,
                                        estado: estado_filtro,
                                        fecha_cita: fecha_hora_cita || null,
                                        resumen: resumen_conversacion,
                                        timestamp: new Date().toISOString(),
                                    },
                                }),
                            });
                            console.log("🔗 Webhook enviado a Make/Zapier");
                        } catch (webhookErr) {
                            console.error("⚠️ Error enviando webhook (no bloqueante):", webhookErr);
                        }
                    }

                    // Agregar el resultado de la tool al historial
                    history.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        content: JSON.stringify({
                            success: true,
                            estado: estado_filtro,
                            message: `Lead ${nombre_cliente} registrado como ${estado_filtro}`,
                        }),
                    });
                } // end if gestionar_lead_crm
            } // end for toolCall

            // ── 5. Segunda llamada a OpenAI para respuesta final ─
            const followUp = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: getSystemPrompt() },
                    ...history,
                ],
            });

            botResponse = followUp.choices[0].message.content || "¡Gracias por tu interés!";
        }

        // Guardar respuesta final en historial
        history.push({ role: "assistant", content: botResponse });

        // Limitar a los últimos 16 mensajes
        if (history.length > 16) {
            history.splice(0, history.length - 16);
        }

        // ── 🛡️ Guardrail: sanitizar JSON fugado en la respuesta ──
        botResponse = sanitizeBotResponse(botResponse);

        // ── 6. Respuesta TwiML a Twilio/WhatsApp ───────────
        const xmlResponse = `
    <?xml version="1.0" encoding="UTF-8"?>
    <Response>
        <Message>${botResponse}</Message>
    </Response>
    `;

        return new Response(xmlResponse, {
            headers: { "Content-Type": "text/xml" },
        });
    } catch (error) {
        console.error("Error en el servidor:", error);
        return new Response("Error", { status: 500 });
    }
}

// ═══════════════════════════════════════════════════════════════
//  🛡️ GUARDRAIL — Limpiar JSON fugado de la respuesta de la IA
// ═══════════════════════════════════════════════════════════════
function sanitizeBotResponse(text: string): string {
    if (!text) return "¡Gracias por tu interés! Un asesor se pondrá en contacto contigo.";

    let cleaned = text;

    // Remove ```json ... ``` blocks
    cleaned = cleaned.replace(/```json[\s\S]*?```/gi, "");
    // Remove ``` ... ``` blocks (any language)
    cleaned = cleaned.replace(/```[\s\S]*?```/gi, "");

    // Remove raw JSON objects like {"nombre_cliente": ...}
    cleaned = cleaned.replace(/\{\s*"[^"]+"\s*:[\s\S]*?\}/g, "");

    // Remove leftover tool-like patterns: gestionar_lead_crm(...)
    cleaned = cleaned.replace(/gestionar_lead_crm\s*\([^)]*\)/gi, "");

    // Trim excessive whitespace
    cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();

    // If nothing meaningful remains after stripping, return a safe fallback
    if (cleaned.length < 5) {
        return "¡Gracias por tu interés! Un asesor se pondrá en contacto contigo.";
    }

    return cleaned;
}
