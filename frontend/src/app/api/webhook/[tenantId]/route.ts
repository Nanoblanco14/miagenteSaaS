import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import type {
    ChatCompletionMessageParam,
    ChatCompletionTool,
} from "openai/resources/chat/completions";
import { isAppointmentCriticalIndustry } from "@/lib/industry-templates";

// ── Supabase Admin (bypasses RLS for webhook) ───────────────
const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
);

// ── In-memory chat history (per phone number) ───────────────
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
                "Actualiza el estado del lead en el CRM. " +
                "REGLA DE ORO: Cada acción que confirmes en el chat DEBE ir acompañada de la llamada a esta herramienta. " +
                "Si dices (o implicas) que agendaste una cita, DEBES llamar a esta función con estado_filtro=\"Calificado\" de forma inmediata, en el mismo turno. " +
                "Si NO llamas a la herramienta, el CRM quedará desactualizado y el lead se perderá. " +
                "Llama a esta función en los siguientes casos exactos: " +
                "(1) El cliente confirma explícitamente un día Y hora para una cita/visita → usa estado_filtro=\"Calificado\". " +
                "(2) El cliente rechaza de forma definitiva, insulta, o dice explícitamente que ya NO le interesa → usa estado_filtro=\"Descartado\". " +
                "(3) La regla de escalación se cumple → usa estado_filtro=\"Derivado a Humano\".",
            parameters: {
                type: "object",
                properties: {
                    nombre_cliente: {
                        type: "string",
                        description:
                            "El nombre y apellido real del usuario. " +
                            "REGLA ESTRICTA: Tienes PROHIBIDO usar valores genéricos como 'Cliente', 'Lead', 'Usuario', 'Lead WhatsApp' o 'N/A'. " +
                            "Si el usuario NO te ha dicho su nombre explícitamente en la conversación activa, NO PUEDES ejecutar esta herramienta. " +
                            "Debes preguntarle su nombre primero y esperar su respuesta antes de invocar la función.",
                    },
                    estado_filtro: {
                        type: "string",
                        enum: ["Calificado", "Descartado", "Derivado a Humano"],
                        description:
                            "Calificado = el prospecto confirmó explícitamente un día Y hora para la cita/visita. Debes moverlo a la etapa de visita/reunión del pipeline. " +
                            "Descartado = el cliente dijo EXPLÍCITAMENTE que NO le interesa, o terminó la conversación de forma negativa o con insultos. " +
                            "NUNCA uses 'Descartado' porque el cliente está pensando, porque no respondió, o porque está agendando una cita — eso es lo OPUESTO de Descartado. " +
                            "⛔ REGLA CRÍTICA DE REPROGRAMACIÓN: Si el cliente pide cambiar la fecha u hora de una cita ya agendada ('¿puedo cambiar la hora?', 'necesito mover la cita'), " +
                            "esto es una señal de ALTO INTERÉS. NUNCA uses 'Descartado' en este caso. Debes mantener 'Calificado' o moverlo a la etapa de visita agendada. " +
                            "SOLO usa 'Descartado' si el cliente rechaza EXPLÍCITAMENTE el servicio, dice que ya no le interesa, o pide no ser contactado. " +
                            "Derivado a Humano = prospecto requiere atención especializada según la regla de escalación configurada.",
                    },
                    fecha_hora_cita: {
                        type: "string",
                        description:
                            "Fecha y hora de la cita en formato ISO 8601 (ej: 2026-02-26T11:00:00). " +
                            "OBLIGATORIO cuando estado_filtro es 'Calificado'. Omitir en otros casos.",
                    },
                    resumen_conversacion: {
                        type: "string",
                        description:
                            "Resumen breve con los datos clave: nombre, presupuesto, zona de interés, tipo de propiedad/servicio, fecha y hora de la cita si aplica, motivo de descarte o derivación si aplica.",
                    },
                },
                required: [
                    "nombre_cliente",
                    "estado_filtro",
                    "resumen_conversacion",
                ],
            },
        },
    },
];

// ═══════════════════════════════════════════════════════════════
//  🧠 SYSTEM PROMPT — Builds the dynamic prompt per tenant
// ═══════════════════════════════════════════════════════════════
function buildSystemPrompt(
    tenantSystemPrompt: string,
    conversationTone?: string | null,
    escalationRule?: string | null,
    pipelineStages?: string[],
    catalogText?: string | null,
    scrapedContext?: string | null,
    industry?: string | null
): string {
    const now = new Date();
    const chileDate = now.toLocaleDateString("es-CL", {
        timeZone: "America/Santiago",
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
    });
    const chileTime = now.toLocaleTimeString("es-CL", {
        timeZone: "America/Santiago",
        hour: "2-digit",
        minute: "2-digit",
    });
    const chileFull = now.toLocaleString("es-CL", {
        timeZone: "America/Santiago",
    });

    // ── Tone instruction block ─────────────────────────────
    const toneBlock = conversationTone
        ? `\n\n═══ TONO DE CONVERSACIÓN ═══
🎭 El tenant ha configurado este tono para todas las conversaciones: "${conversationTone}".
Adapta tu vocabulario, nivel de formalidad y estilo de escritura para reflejar ese tono en cada mensaje.`
        : "";

    // ── Escalation rule block ──────────────────────────────
    const escalationBlock = escalationRule
        ? `\n\n═══ REGLA DE DERIVACIÓN A HUMANO ═══
⚠️ Cuando detectes la siguiente situación, llama INMEDIATAMENTE a gestionar_lead_crm con estado_filtro="Derivado a Humano":
"${escalationRule}"
No intentes resolver esa situación tú mismo. Deriva de inmediato y notifica cordialmente al cliente que un asesor humano se contactará pronto.`
        : "";

    // ── Pipeline stages block ──────────────────────────────
    const stagesBlock = pipelineStages && pipelineStages.length > 0
        ? `\n\n═══ ETAPAS DEL PIPELINE DE VENTAS (REAL) ═══
Estas son las etapas EXACTAS que existen en el CRM del cliente. Debes usar ÚNICAMENTE estos nombres al llamar a la herramienta gestionar_lead_crm:
${pipelineStages.map((s, i) => `${i + 1}. ${s}`).join("\n")}
USA SIEMPRE el nombre exacto de la etapa, sin inventar variantes.`
        : "";

    // ── Catalog block ──────────────────────────────────────
    const catalogBlock = catalogText
        ? `\n\n═══ CATÁLOGO DE PRODUCTOS/SERVICIOS ═══
${catalogText}
USA ESTA INFORMACIÓN para responder preguntas sobre disponibilidad, precios y características. No menciones productos que no estén en este listado.`
        : "";

    // ── Scraped context block ──────────────────────────────
    const knowledgeBlock = scrapedContext
        ? `\n\n═══ CONOCIMIENTO ADICIONAL DE LA EMPRESA ═══
${scrapedContext}
Usa este conocimiento para responder preguntas generales sobre la empresa, sus servicios, ubicación o cualquier otra información mencionada arriba.`
        : "";

    // The tenant's custom prompt is the core; we inject everything around it
    return `${tenantSystemPrompt}${toneBlock}${escalationBlock}${stagesBlock}${catalogBlock}${knowledgeBlock}

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

═══ OBLIGACIÓN DE USO DE HERRAMIENTA ═══
🚨 OBLIGATORIO: Ya sea para agendar (Calificado), descartar (Descartado) o derivar a humano (Derivado a Humano), NUNCA te despidas sin usar la herramienta gestionar_lead_crm.
Si omites la herramienta, el sistema fallará y el cliente se perderá del CRM.
SIEMPRE llama a la función ANTES de tu mensaje de despedida.

═══ IMPORTANTE ═══
- El resumen_conversacion debe incluir los datos clave extraídos: presupuesto mencionado, interés principal, motivo de derivación si aplica.
- REPITO: NO escribas JSON en tus mensajes. Usa SOLO la herramienta.

═══ REGLAS SUPREMAS DE CONVERSACIÓN Y SISTEMA (INQUEBRANTABLES) ═══
ESTILO DE COMUNICACIÓN (CERO INTERROGATORIOS):
- ESTÁ ESTRICTAMENTE PROHIBIDO enviar listas numeradas o hacer más de UNA pregunta a la vez.
- La conversación debe ser fluida, cálida y humana. Haz una pregunta, espera la respuesta del cliente, reacciona con empatía y luego haz la siguiente pregunta.

OBTENCIÓN DEL NOMBRE:
- Si no tienes el nombre del cliente, debes averiguarlo de forma sutil en el primer o segundo mensaje (ej. "Por cierto, ¿con quién tengo el gusto?" o "Para atenderte mejor, ¿me podrías indicar tu nombre?"). Esto es obligatorio.

🛑 BARRERA DE IDENTIFICACIÓN — HARD BLOCK UNIVERSAL (TODAS LAS INDUSTRIAS, INQUEBRANTABLE) 🛑
🚨 REGLA ABSOLUTA: Es IMPOSIBLE ejecutar gestionar_lead_crm, agendar una cita, tomar un pedido (delivery/retiro) o mover al cliente a cualquier etapa de tipo «Agendado» / «Visita Agendada» / «Cita Agendada» sin tener el NOMBRE REAL del cliente, dicho por él mismo en esta conversación activa.
❌ Si el cliente acepta agendar o confirma hora, y aún NO conoces su nombre real, tu ÚNICA respuesta permitida en ese turno es pedirlo. EJEMPLO OBLIGATORIO:
"¡Perfecto! El viernes a las 11:00 está disponible. Para dejar la cita registrada a tu nombre, ¿me podrías indicar tu nombre y apellido?"
❌ NO importa si el número ya existía en el CRM: si el nombre guardado es 'Cliente', 'Lead WhatsApp', nulo o cualquier valor genérico, se considera que NO tienes el nombre y DEBES pedirlo.
✅ SOLO puedes llamar a gestionar_lead_crm cuando el usuario haya escrito su nombre explícitamente en esta conversación activa.
Esta regla aplica para TODAS las plantillas sin excepción: Inmobiliaria, E-commerce, Peluquería, Dental, y cualquier otra industria.

SILENCIO ABSOLUTO SOBRE HERRAMIENTAS Y ESTADOS:
- NUNCA menciones que actualizaste el sistema, cambiaste una etapa, o usaste una herramienta.
- PROHIBIDO usar frases como "He registrado tu solicitud como...", "Actualicé el sistema" o mencionar nombres de etapas internos.
- Si debes derivar a un asesor, simplemente di: "Comprendo. Le pediré a uno de nuestros asesores que se contacte contigo a la brevedad para ayudarte personalmente." Ejecuta la herramienta de cambio de etapa en total silencio.

ACTUALIZACIÓN DEL PIPELINE (CRM):
- Tienes la obligación de mantener actualizado el estado del cliente en el embudo de ventas.
- Si el cliente muestra interés inicial, muévelo a la etapa correspondiente (ej. primer elemento de las etapas disponibles tras "Nuevo Lead").
- Si el cliente agenda una reunión o acepta que lo contacte un asesor, DEBES usar la herramienta para moverlo a la etapa de visita/reunión según las etapas disponibles. NO lo dejes en la primera etapa.
- Usa los nombres EXACTOS de las etapas listadas en la sección ETAPAS DEL PIPELINE DE VENTAS de arriba.

═══ EJECUCIÓN DE HERRAMIENTAS — SINCRONÍA TEXTO-ACCIÓN (INQUEBRANTABLE) ═══
🚨 REGLA ABSOLUTA: Lo que dices en el chat y lo que ejecutas en el CRM DEBEN ser idénticos. Si en tu respuesta de texto confirmas o implicas que se ha agendado una cita, DEBES invocar OBLIGATORIAMENTE en ese mismo turno la herramienta gestionar_lead_crm con estado_filtro="Calificado" y mover al lead a la etapa de visita/cita del pipeline.
🚫 PROHIBIDO: Decir frases equivalentes a "¡Tu cita está agendada!" o "Tu visita quedó confirmada para el [fecha]" sin que en ese mismo turno hayas llamado a la herramienta. El sistema detecta esta inconsistencia. Si el texto dice «agendado» pero no hay tool call, es un error crítico que deja el lead abandonado en la primera etapa del CRM.
✅ CORRECTO: Cliente confirma día y hora → inmediatamente en ese turno llamas a gestionar_lead_crm(estado_filtro="Calificado", fecha_hora_cita="...") → luego envías el mensaje de confirmación al cliente.
❌ INCORRECTO: Enviar el mensaje de confirmación sin haber llamado a la herramienta en ese mismo turno.

═══ REGLA ESTRICTA DE ESTADOS — PROHIBICIÓN DE "DESCARTADO" PREMATURO ═══
🚫 NUNCA uses estado_filtro="Descartado" en ninguno de estos escenarios:
  - El cliente está agendando o acaba de agendar una cita.
  - El cliente está pensando, pidiendo tiempo, o comparando opciones.
  - El cliente no ha respondido aún o tardó en responder.
  - La conversación terminó de forma neutral o positiva.
  - El cliente mostró incluso mínimo interés.
✅ SOLO usa estado_filtro="Descartado" cuando el cliente EXPLÍCITAMENTE diga: "No me interesa", "Ya encontré otro", "No quiero saber nada", te insulte, o rechace de forma definitiva y clara toda posibilidad de continuar. Un cliente que agenda una visita es, por definición, el caso MÁS OPUESTO a un lead Descartado.

═══════════════════════════════════════════════════════════════
📅 REGLA DE FECHAS — HARD BLOCK UNIVERSAL (TODAS LAS INDUSTRIAS)
═══════════════════════════════════════════════════════════════
Tienes la fecha y hora actuales en tu contexto (ver sección FECHA Y HORA ACTUAL arriba).
🚫 PROHIBICIÓN ABSOLUTA: NUNCA adivines ni supongas el día de la semana para una fecha dada.
✅ CÓMO OPERAR:
  1. Si el cliente menciona un día de la semana (ej. "el viernes"), calcula cuál es la fecha exacta (número de día y mes) a partir de HOY, y confírmala antes de agendar.
  2. Si el cliente menciona una fecha (ej. "el 5 de marzo"), calcula cuál es el día de la semana EXACTO para esa fecha y confírmalo antes de agendar.
  3. NUNCA digas cosas como "el miércoles 5" si el 5 es jueves — eso es un error crítico que destruye la confianza del cliente.
  4. SIEMPRE confirma: "¿Te parece bien el [día calculado correctamente] [fecha] a las [hora]?" antes de llamar a gestionar_lead_crm.
  5. NUNCA uses años anteriores al año actual (${now.getFullYear()}).
Esta regla es INQUEBRANTABLE para TODAS las plantillas de industria.

═══════════════════════════════════════════════════════════════
🛑 REGLA DE INVENTARIO — ANTI-ALUCINACIÓN (HARD BLOCK UNIVERSAL)
═══════════════════════════════════════════════════════════════
Tu ÚNICA fuente de verdad de productos, servicios o propiedades es la sección [CATÁLOGO/INVENTARIO] de este prompt.
🚫 TIENES ESTRICTAMENTE PROHIBIDO:
  - Inventar, suponer o mencionar productos, propiedades, servicios, precios o características que NO aparezcan explícitamente en el catálogo.
  - Ofrecer alternativas genéricas cuando el catálogo no tiene lo que busca el cliente.
  - Decir "tenemos algo similar" si no aparece en el catálogo.
✅ SI EL CATÁLOGO ESTÁ VACÍO O NO TIENE LO QUE BUSCA EL CLIENTE:
  - Informa al cliente con honestidad que en este momento no cuentas con ese producto/propiedad/servicio.
  - Ofréce derivarlo a un asesor humano o quedar en avisarle cuando haya disponibilidad.
  - Ejecuta gestionar_lead_crm con estado_filtro="Derivado a Humano" si aplica.
Esta regla es INQUEBRANTABLE para TODAS las plantillas de industria.

═══════════════════════════════════════════════════════════════
🔄 REGLA DE REPROGRAMACIÓN — HARD BLOCK UNIVERSAL
═══════════════════════════════════════════════════════════════
Si un cliente pide cambiar la fecha u hora de una cita ya agendada, esto es un indicador de ALTO INTERÉS en el servicio.
🚫 NUNCA, BAJO NINGUNA CIRCUNSTANCIA debes:
  - Cambiar el estado del lead a "Descartado" al reprogramar.
  - Interpretar una solicitud de cambio de fecha como un rechazo o pérdida de interés.
✅ AL REPROGRAMAR DEBES:
  1. Confirmar la nueva fecha y hora con el cliente (aplicando la REGLA DE FECHAS).
  2. Llamar a gestionar_lead_crm con estado_filtro="Calificado" y la nueva fecha_hora_cita.
  3. Mantener o mejorar la etapa del lead en el pipeline (nunca retrocederla a "Descartado").
Esta regla es INQUEBRANTABLE para TODAS las plantillas de industria.`;
}


// ═══════════════════════════════════════════════════════════════
//  📨 MESSAGE PARSERS — Extract message/sender per provider
// ═══════════════════════════════════════════════════════════════

interface ParsedMessage {
    body: string;
    sender: string;
    phoneClean: string;
}

async function parseTwilioMessage(req: Request): Promise<ParsedMessage> {
    const formData = await req.formData();
    const body = formData.get("Body")?.toString() || "";
    const sender = formData.get("From")?.toString() || "";
    const phoneClean = sender.replace("whatsapp:", "");
    return { body, sender, phoneClean };
}

async function parseMetaMessage(
    req: Request
): Promise<ParsedMessage | null> {
    const json = await req.json();
    const entry = json?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;

    if (!messages || messages.length === 0) return null;

    const msg = messages[0];
    const body = msg.text?.body || "";
    const sender = msg.from || "";
    const phoneClean = sender.replace(/^\+/, "");
    return { body, sender, phoneClean };
}

// ═══════════════════════════════════════════════════════════════
//  📤 RESPONSE SENDERS — Send reply per provider
// ═══════════════════════════════════════════════════════════════

function buildTwilioResponse(text: string): Response {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Message>${text}</Message>
</Response>`;
    return new Response(xml, { headers: { "Content-Type": "text/xml" } });
}

async function sendMetaReply(
    phoneNumberId: string,
    accessToken: string,
    recipientPhone: string,
    text: string
): Promise<void> {
    await fetch(
        `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                messaging_product: "whatsapp",
                to: recipientPhone,
                type: "text",
                text: { body: text },
            }),
        }
    );
}

// ═══════════════════════════════════════════════════════════════
//  🛡️ GUARDRAIL — Clean leaked JSON from AI response
// ═══════════════════════════════════════════════════════════════
function sanitizeBotResponse(text: string): string {
    if (!text)
        return "¡Gracias por tu interés! Un asesor se pondrá en contacto contigo.";
    let cleaned = text;
    cleaned = cleaned.replace(/```json[\s\S]*?```/gi, "");
    cleaned = cleaned.replace(/```[\s\S]*?```/gi, "");
    cleaned = cleaned.replace(/\{\s*"[^"]+"\s*:[\s\S]*?\}/g, "");
    cleaned = cleaned.replace(/gestionar_lead_crm\s*\([^)]*\)/gi, "");
    cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
    if (cleaned.length < 5) {
        return "¡Gracias por tu interés! Un asesor se pondrá en contacto contigo.";
    }
    return cleaned;
}

// ═══════════════════════════════════════════════════════════════
//  🧹 SANITIZE MESSAGE HISTORY — Ensure valid tool call pairing
// ═══════════════════════════════════════════════════════════════
function sanitizeMessageHistory(
    messages: ChatCompletionMessageParam[]
): ChatCompletionMessageParam[] {
    // ── Phase 1: Deep-copy & normalize tool_calls from DB JSON strings ──
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed: any[] = messages.map((m) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const msg = { ...m } as any;
        if (msg.role === "assistant" && msg.tool_calls) {
            // top-level tool_calls might be a JSON string from the DB
            if (typeof msg.tool_calls === "string") {
                try {
                    msg.tool_calls = JSON.parse(msg.tool_calls);
                } catch {
                    delete msg.tool_calls;
                }
            }
            if (Array.isArray(msg.tool_calls)) {
                msg.tool_calls = msg.tool_calls
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    .map((tc: any) => {
                        // individual tool_call might be a JSON string
                        if (typeof tc === "string") {
                            try { return JSON.parse(tc); } catch { return null; }
                        }
                        // arguments must be a string for OpenAI — re-serialize if object
                        if (tc && tc.function && typeof tc.function.arguments !== "string") {
                            tc.function.arguments = JSON.stringify(tc.function.arguments);
                        }
                        return tc;
                    })
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    .filter((tc: any) => tc !== null && tc.id);

                if (msg.tool_calls.length === 0) {
                    delete msg.tool_calls;
                }
            }
        }
        return msg;
    });

    // ── Phase 2: Catalogue which tool_call IDs have a matching tool-response ──
    const respondedToolCallIds = new Set<string>();
    for (const m of parsed) {
        if (m.role === "tool" && m.tool_call_id) {
            respondedToolCallIds.add(m.tool_call_id);
        }
    }

    // ── Phase 3: Identify assistant messages whose tool_calls are fully responded ──
    //   If ANY tool_call in an assistant msg has no tool response, strip tool_calls
    //   from that assistant (avoids OpenAI error in both directions).
    const validToolCallIds = new Set<string>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const incompleteAssistants = new WeakSet<any>();
    for (const m of parsed) {
        if (
            m.role === "assistant" &&
            Array.isArray(m.tool_calls) &&
            m.tool_calls.length > 0
        ) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const allResponded = m.tool_calls.every((tc: any) =>
                tc.id && respondedToolCallIds.has(tc.id)
            );
            if (allResponded) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                for (const tc of m.tool_calls) validToolCallIds.add(tc.id);
            } else {
                incompleteAssistants.add(m);
                console.warn(
                    `🧹 Stripping tool_calls from assistant with missing tool responses`
                );
            }
        }
    }

    // ── Phase 4: Build clean history, removing orphaned tool msgs and fixing assistants ──
    const sanitized: ChatCompletionMessageParam[] = [];
    for (let i = 0; i < parsed.length; i++) {
        const m = parsed[i];

        // Strip tool_calls from assistants that had unmatched calls
        if (incompleteAssistants.has(m)) {
            const { tool_calls: _dropped, ...rest } = m;
            void _dropped;
            if (rest.content) sanitized.push(rest); // only keep if has text
            continue;
        }

        if (m.role === "tool") {
            const toolCallId = m.tool_call_id;
            if (!toolCallId || !validToolCallIds.has(toolCallId)) {
                console.warn(
                    `🧹 Removing orphaned tool message (tool_call_id: ${toolCallId})`
                );
                continue;
            }
            // Verify the assistant with that tool_call actually precedes us in sanitized
            let foundPrecedingAssistant = false;
            for (let j = sanitized.length - 1; j >= 0; j--) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const prev = sanitized[j] as any;
                if (
                    prev.role === "assistant" &&
                    Array.isArray(prev.tool_calls) &&
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    prev.tool_calls.some((tc: any) => tc.id === toolCallId)
                ) {
                    foundPrecedingAssistant = true;
                    break;
                }
            }
            if (!foundPrecedingAssistant) {
                console.warn(
                    `🧹 Removing tool message with no preceding assistant in sanitized (tool_call_id: ${toolCallId})`
                );
                continue;
            }
        }

        sanitized.push(m);
    }

    return sanitized as ChatCompletionMessageParam[];
}

// ═══════════════════════════════════════════════════════════════
//  Tenant type for clarity
// ═══════════════════════════════════════════════════════════════
interface TenantConfig {
    id: string;
    name: string;
    openai_api_key: string;
    whatsapp_provider: "twilio" | "meta";
    whatsapp_credentials: Record<string, string>;
}

// ═══════════════════════════════════════════════════════════════
//  GET handler — Meta Webhook Verification (challenge)
// ═══════════════════════════════════════════════════════════════
export async function GET(
    req: Request,
    { params }: { params: Promise<{ tenantId: string }> }
) {
    const { tenantId } = await params;
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token && challenge) {
        // Look up the tenant's verify_token
        const { data: tenant } = await supabaseAdmin
            .from("organizations")
            .select("whatsapp_credentials")
            .eq("id", tenantId)
            .single();

        if (
            tenant?.whatsapp_credentials?.verify_token &&
            tenant.whatsapp_credentials.verify_token === token
        ) {
            return new Response(challenge, { status: 200 });
        }
        return new Response("Forbidden", { status: 403 });
    }

    return new Response("OK", { status: 200 });
}

// ═══════════════════════════════════════════════════════════════
//  POST handler — Dynamic Multi-Tenant Webhook
// ═══════════════════════════════════════════════════════════════
export async function POST(
    req: Request,
    { params }: { params: Promise<{ tenantId: string }> }
) {
    const { tenantId } = await params;

    try {
        // ── 1. Load tenant config ─────────────────────────────
        const { data: tenant, error: tenantError } = await supabaseAdmin
            .from("organizations")
            .select(
                "id, name, openai_api_key, whatsapp_provider, whatsapp_credentials, settings"
            )
            .eq("id", tenantId)
            .single();

        if (tenantError || !tenant) {
            console.error(`❌ Tenant not found: ${tenantId}`);
            return new Response(
                JSON.stringify({ error: "Tenant not found" }),
                { status: 404 }
            );
        }

        const t = tenant as TenantConfig;

        if (!t.openai_api_key) {
            console.error(`❌ Tenant ${t.name} has no OpenAI API key`);
            return new Response(
                JSON.stringify({
                    error: "Tenant has no OpenAI API key configured",
                }),
                { status: 400 }
            );
        }

        // ── 2. Parse incoming message by provider ─────────────
        let parsed: ParsedMessage | null = null;

        if (t.whatsapp_provider === "twilio") {
            parsed = await parseTwilioMessage(req);
        } else if (t.whatsapp_provider === "meta") {
            parsed = await parseMetaMessage(req);
            // Meta sends status updates that have no messages
            if (!parsed) {
                return new Response("OK", { status: 200 });
            }
        }

        if (!parsed || !parsed.body) {
            return new Response("OK", { status: 200 });
        }

        const { body: incomingMsg, sender, phoneClean } = parsed;
        console.log(
            `📩 [${t.name}] WhatsApp de ${sender}: ${incomingMsg}`
        );

        // ── 3. Load agent's system prompt ─────────────────────
        const { data: agent } = await supabaseAdmin
            .from("agents")
            .select("system_prompt, booking_url, conversation_tone, escalation_rule")
            .eq("organization_id", tenantId)
            .eq("is_active", true)
            .limit(1)
            .single();

        const basePrompt =
            agent?.system_prompt ||
            "Eres un asistente de ventas profesional. Filtra prospectos haciendo preguntas clave sobre qué buscan, su presupuesto y zona de interés.";

        // Inject booking URL if available
        let fullPrompt = basePrompt;
        if (agent?.booking_url) {
            fullPrompt += `\n\n═══ ENLACE DE AGENDAMIENTO ═══\nCuando el prospecto califique, entrégale este link para agendar: ${agent.booking_url}`;
        }

        // ── 4. Chat memory ────────────────────────────────────
        const memoryKey = `${tenantId}:${sender}`;
        if (!chatMemory.has(memoryKey)) {
            chatMemory.set(memoryKey, []);
        }
        const history = chatMemory.get(memoryKey)!;
        history.push({ role: "user", content: incomingMsg });

        // ── 4b. Live tracking status ──────────────────────────
        const msgCount = history.filter((m) => m.role === "user").length;
        let liveChatStatus = "Contacto inicial";
        if (msgCount === 1) liveChatStatus = "Contacto inicial";
        else if (msgCount <= 3) liveChatStatus = "Consultando opciones";
        else liveChatStatus = "Filtrando perfil";

        // Upsert live status
        const { data: existingForStatus } = await supabaseAdmin
            .from("leads")
            .select("id, is_bot_paused")
            .eq("organization_id", tenantId)
            .eq("phone", phoneClean)
            .limit(1);

        const leadAlreadyExists =
            existingForStatus && existingForStatus.length > 0;

        // ── 4b-1. HUMAN TAKEOVER — early exit if bot is paused ─
        if (leadAlreadyExists && existingForStatus[0].is_bot_paused) {
            console.log(`⏸️ [${t.name}] Bot pausado para ${phoneClean}. Mensaje ignorado.`);
            if (t.whatsapp_provider === "twilio") {
                return buildTwilioResponse(""); // TwiML empty response, no message sent
            }
            return new Response("OK", { status: 200 });
        }

        if (leadAlreadyExists) {
            // Lead ya existe → solo actualizar el chat_status, nunca duplicar
            await supabaseAdmin
                .from("leads")
                .update({ chat_status: liveChatStatus })
                .eq("id", existingForStatus[0].id);
        } else {
            // Lead nuevo → insertar solo si verdaderamente no existe en la BD
            const { data: firstStage } = await supabaseAdmin
                .from("pipeline_stages")
                .select("id")
                .eq("organization_id", tenantId)
                .order("position", { ascending: true })
                .limit(1);

            await supabaseAdmin.from("leads").insert({
                organization_id: tenantId,
                stage_id: firstStage?.[0]?.id || "",
                name: "Lead WhatsApp",
                phone: phoneClean,
                source: "whatsapp",
                chat_status: liveChatStatus,
            });
        }

        // ── Resolve leadId for message persistence ────────────
        let leadId: string | null = null;
        if (leadAlreadyExists) {
            leadId = existingForStatus[0].id;
        } else {
            // Fetch the just-inserted row
            const { data: newLeadRow } = await supabaseAdmin
                .from("leads")
                .select("id")
                .eq("organization_id", tenantId)
                .eq("phone", phoneClean)
                .limit(1)
                .single();
            leadId = newLeadRow?.id ?? null;
        }

        // ── Save incoming user message ────────────────────────
        if (leadId) {
            await supabaseAdmin.from("lead_messages").insert({
                lead_id: leadId,
                role: "user",
                content: incomingMsg,
            });
        }

        // ── 4c. Fetch real pipeline stages for this tenant ────
        const { data: stageDocs } = await supabaseAdmin
            .from("pipeline_stages")
            .select("name")
            .eq("organization_id", tenantId)
            .order("position", { ascending: true });
        const pipelineStageNames: string[] = (stageDocs || []).map(
            (s: { name: string }) => s.name
        );

        // ── 5. Fetch catalog & company knowledge for this tenant ──
        const [{ data: catalogItems }, { data: agentWithContext }] = await Promise.all([
            supabaseAdmin
                .from("products")
                .select("name, description, attributes")
                .eq("organization_id", tenantId)
                .eq("status", "active")
                .order("created_at", { ascending: true }),
            supabaseAdmin
                .from("agents")
                .select("scraped_context")
                .eq("organization_id", tenantId)
                .limit(1)
                .maybeSingle(),
        ]);

        // Format catalog as concise text
        // If catalog is empty we inject an explicit sentinel so the AI KNOWS
        // it has nothing to offer and cannot hallucinate products.
        let catalogText: string;
        if (!catalogItems || catalogItems.length === 0) {
            catalogText =
                "[CATÁLOGO ACTUAL: Vacío. No tienes productos, propiedades ni servicios para ofrecer en este momento. " +
                "Si el cliente te solicita algo, debes informarle con amabilidad que no hay disponibilidad actualmente " +
                "y ofrecerte a avisarle cuando haya novedades. NUNCA inventes ni ofrezcas algo que no exista aquí.]";
        } else {
            catalogText = catalogItems.map((item: any, idx: number) => {
                const attrs = item.attributes || {};
                const attrsStr = Object.entries(attrs)
                    .map(([k, v]) => `  • ${k}: ${v}`)
                    .join("\n");
                return `${idx + 1}. ${item.name}${item.description ? " — " + item.description : ""}${attrsStr ? "\n" + attrsStr : ""}`;
            }).join("\n\n");
        }

        const scrapedContext: string | null = agentWithContext?.scraped_context ?? null;

        // ── 6. Call OpenAI with tenant's own API key ──────────
        const tenantOpenai = new OpenAI({ apiKey: t.openai_api_key });
        const industryId: string | null = (tenant as any)?.settings?.industry_template ?? null;
        const systemPrompt = buildSystemPrompt(
            fullPrompt,
            agent?.conversation_tone,
            agent?.escalation_rule,
            pipelineStageNames,
            catalogText,
            scrapedContext,
            industryId
        );

        const sanitizedHistory = sanitizeMessageHistory(history);
        const completion = await tenantOpenai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: systemPrompt },
                ...sanitizedHistory,
            ],
            tools,
            tool_choice: "auto",
        });

        const choice = completion.choices[0];
        const assistantMsg = choice.message;
        let botResponse = assistantMsg.content || "";

        // ── 6. Handle tool calls ──────────────────────────────
        if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
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

                    console.log(
                        `🔧 [${t.name}] Tool call: ${estado_filtro} — ${nombre_cliente}`
                    );

                    // Find target stage
                    let targetStageName = "";
                    if (estado_filtro === "Calificado") {
                        targetStageName = "isita"; // matches "Visita Agendada"
                    } else if (estado_filtro === "Descartado") {
                        targetStageName = "escart"; // matches "Descartado/Perdido"
                    }

                    const { data: matchedStages } = await supabaseAdmin
                        .from("pipeline_stages")
                        .select("id")
                        .eq("organization_id", tenantId)
                        .ilike("name", `%${targetStageName}%`)
                        .limit(1);

                    let targetStageId = matchedStages?.[0]?.id;
                    if (!targetStageId) {
                        const { data: fallbackStages } = await supabaseAdmin
                            .from("pipeline_stages")
                            .select("id")
                            .eq("organization_id", tenantId)
                            .order("position", { ascending: true })
                            .limit(2);
                        if (
                            estado_filtro === "Derivado a Humano" &&
                            fallbackStages &&
                            fallbackStages.length >= 2
                        ) {
                            targetStageId = fallbackStages[1].id;
                        } else {
                            targetStageId = fallbackStages?.[0]?.id;
                        }
                    }

                    // Upsert lead
                    const { data: existingLeads } = await supabaseAdmin
                        .from("leads")
                        .select("id")
                        .eq("organization_id", tenantId)
                        .eq("phone", phoneClean)
                        .limit(1);

                    const finalChatStatus =
                        estado_filtro === "Calificado"
                            ? fecha_hora_cita
                                ? "Cita agendada"
                                : "Negociando horario"
                            : estado_filtro === "Derivado a Humano"
                                ? "Derivado a humano"
                                : "Descartado";

                    const leadPayload: Record<string, string> = {
                        name: nombre_cliente || "Lead WhatsApp",
                        phone: phoneClean,
                        notes: resumen_conversacion || "",
                        source: "whatsapp",
                        stage_id: targetStageId || "",
                        chat_status: finalChatStatus,
                    };

                    if (
                        estado_filtro === "Calificado" &&
                        fecha_hora_cita
                    ) {
                        leadPayload.appointment_date = fecha_hora_cita;
                    }

                    if (existingLeads && existingLeads.length > 0) {
                        await supabaseAdmin
                            .from("leads")
                            .update(leadPayload)
                            .eq("id", existingLeads[0].id);
                        console.log(
                            `✅ [${t.name}] Lead actualizado: ${nombre_cliente} → ${estado_filtro}`
                        );
                    } else {
                        await supabaseAdmin.from("leads").insert({
                            organization_id: tenantId,
                            ...leadPayload,
                        });
                        console.log(
                            `✅ [${t.name}] Lead creado: ${nombre_cliente} → ${estado_filtro}`
                        );
                    }

                    // ── In-app notification (Derivado a Humano) ──────────
                    if (estado_filtro === "Derivado a Humano") {
                        // Resolve the lead id (may have just been created)
                        const { data: notifLead } = await supabaseAdmin
                            .from("leads")
                            .select("id")
                            .eq("organization_id", tenantId)
                            .eq("phone", phoneClean)
                            .limit(1)
                            .single();

                        const notifMessage =
                            nombre_cliente && nombre_cliente !== "Lead WhatsApp"
                                ? `${nombre_cliente} solicitó atención humana`
                                : `Un cliente (${phoneClean}) solicitó atención humana`;

                        await supabaseAdmin.from("notifications").insert({
                            tenant_id: tenantId,
                            lead_id: notifLead?.id || null,
                            type: "handoff",
                            message: notifMessage,
                        });
                        console.log(`🔔 [${t.name}] Notificación creada: ${notifMessage}`);
                        // TODO: Integrar Resend para enviar email al tenant.email
                    }


                    const webhookUrl = process.env.MAKE_WEBHOOK_URL;
                    if (webhookUrl) {
                        try {
                            await fetch(webhookUrl, {
                                method: "POST",
                                headers: {
                                    "Content-Type": "application/json",
                                },
                                body: JSON.stringify({
                                    event: "lead_updated",
                                    tenant_id: tenantId,
                                    tenant_name: t.name,
                                    lead: {
                                        nombre: nombre_cliente,
                                        telefono: phoneClean,
                                        estado: estado_filtro,
                                        fecha_cita:
                                            fecha_hora_cita || null,
                                        resumen: resumen_conversacion,
                                        timestamp:
                                            new Date().toISOString(),
                                    },
                                }),
                            });
                            console.log(
                                "🔗 Webhook enviado a Make/Zapier"
                            );
                        } catch (webhookErr) {
                            console.error(
                                "⚠️ Error enviando webhook (no bloqueante):",
                                webhookErr
                            );
                        }
                    }

                    history.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        content: JSON.stringify({
                            success: true,
                            estado: estado_filtro,
                            message: `Lead ${nombre_cliente} registrado como ${estado_filtro}`,
                        }),
                    });
                }
            }

            // Follow-up call for final text response
            const sanitizedHistoryFollowUp = sanitizeMessageHistory(history);
            const followUp = await tenantOpenai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: systemPrompt },
                    ...sanitizedHistoryFollowUp,
                ],
            });

            botResponse =
                followUp.choices[0].message.content ||
                "¡Gracias por tu interés!";
        }

        // Save to history
        history.push({ role: "assistant", content: botResponse });
        if (history.length > 16) {
            history.splice(0, history.length - 16);
            // Re-sanitize after truncation to remove any orphaned tool messages
            const trimmed = sanitizeMessageHistory(history);
            history.length = 0;
            history.push(...trimmed);
        }

        // Sanitize
        botResponse = sanitizeBotResponse(botResponse);

        // ── Save bot response to lead_messages ─────────────────
        if (leadId && botResponse) {
            await supabaseAdmin.from("lead_messages").insert({
                lead_id: leadId,
                role: "assistant",
                content: botResponse,
            });
        }

        // ── 7. Send response per provider ─────────────────────
        if (t.whatsapp_provider === "meta") {
            const phoneNumberId =
                t.whatsapp_credentials?.phone_number_id || "";
            const accessToken =
                t.whatsapp_credentials?.access_token || "";

            if (phoneNumberId && accessToken) {
                await sendMetaReply(
                    phoneNumberId,
                    accessToken,
                    phoneClean,
                    botResponse
                );
            }
            return new Response("OK", { status: 200 });
        }

        // Default: Twilio TwiML
        return buildTwilioResponse(botResponse);
    } catch (error) {
        console.error(`❌ Webhook error [tenant: ${tenantId}]:`, error);
        return new Response("Error", { status: 500 });
    }
}
