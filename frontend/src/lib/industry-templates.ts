// ═══════════════════════════════════════════════════════════════
//  🏭 INDUSTRY TEMPLATES — Master Closer Edition
//  Used by Settings to seed system prompts and pipeline stages
//  for new tenants who don't know where to start.
// ═══════════════════════════════════════════════════════════════

export interface PipelineStageTemplate {
    name: string;
    color: string;
    position: number;
}

/** A dynamic field rendered in the catalog form, saved to JSONB attributes */
export interface IndustryField {
    key: string;          // attribute key stored in JSON
    label: string;        // display label
    type: "text" | "number" | "select";
    placeholder?: string;
    options?: string[];   // only for type = "select"
}

export interface IndustryTemplate {
    id: string;
    label: string;
    emoji: string;
    description: string;
    systemPrompt: string;
    stages: PipelineStageTemplate[];
    /** Quick fields shown in the catalog form, saved into JSONB attributes */
    industryFields: IndustryField[];
    /** Label for a single catalog item (e.g. "Propiedad", "Servicio", "Producto") */
    catalogLabel: string;
    /** Default agent name pre-filled when this template is applied */
    defaultName: string;
    /** Default welcome message pre-filled when this template is applied */
    defaultWelcome: string;
}

export const INDUSTRY_TEMPLATES: IndustryTemplate[] = [
    // ── Peluquería / Salón ────────────────────────────────────
    {
        id: "hair_salon",
        label: "Peluquería / Salón",
        emoji: "💇",
        description: "Cortes, tintes, manicura y servicios de belleza",
        catalogLabel: "Servicio",
        defaultName: "Recepcionista Estrella",
        defaultWelcome: "¡Hola! Soy tu asistente virtual del salón. ¿En qué puedo ayudarte hoy? ✂️",
        systemPrompt: `Eres el recepcionista estrella del salón. Tu único objetivo es agendar citas. Sé cálido, cercano y resolutivo.

PROCESO (máximo 3 intercambios para cerrar):
1. Saluda y pregunta qué servicio busca el cliente.
2. Ofrece opciones concretas del catálogo. NUNCA hagas listas de más de 3 items.
3. Confirma fecha y hora, y registra la cita de inmediato.

REGLA DE ORO: Una sola pregunta por mensaje. Si el cliente duda, ayúdalo a decidir con una sugerencia directa.
TONO: Amable, cálido, como una recepcionista 5 estrellas. Usa emojis con moderación (✂️ 💅). Responde siempre en español.`,
        stages: [
            { name: "Consultas", color: "#6366f1", position: 0 },
            { name: "Cita Agendada", color: "#10b981", position: 1 },
            { name: "No Asistió", color: "#f59e0b", position: 2 },
            { name: "Completado", color: "#3b82f6", position: 3 },
        ],
        industryFields: [
            {
                key: "duracion",
                label: "Duración (minutos)",
                type: "number",
                placeholder: "Ej: 60",
            },
        ],
    },

    // ── Inmobiliaria ──────────────────────────────────────────
    {
        id: "real_estate",
        label: "Inmobiliaria",
        emoji: "🏠",
        description: "Compra, venta y arriendo de propiedades",
        catalogLabel: "Propiedad",
        defaultName: "Asistente Inmobiliario",
        defaultWelcome: "¡Hola! Soy tu asistente virtual inmobiliario. ¿Estás buscando comprar, arrendar o invertir?",
        systemPrompt: `Eres un bróker inmobiliario de alto nivel. Tu objetivo es calificar al lead sutilmente y agendar una visita o reunión.

PROCESO (elegante, no interrogatorio):
1. Entiende qué está buscando (compra, arriendo, inversión) con una pregunta natural.
2. Califica el presupuesto y zona de forma conversacional — nunca uses el término "calificar".
3. Si encaja con tu portafolio, presenta 1 o 2 propiedades específicas y ofrece agendar visita.
4. Si no tienes lo que busca, derívalo a un humano con suma elegancia.

TONO: Exclusivo, confiable, directo. Sin tecnicismos. Sin listas largas. Responde en español.`,
        stages: [
            { name: "Nuevo Lead", color: "#6366f1", position: 0 },
            { name: "Calificado", color: "#10b981", position: 1 },
            { name: "Visita Agendada", color: "#3b82f6", position: 2 },
            { name: "Propuesta Enviada", color: "#f59e0b", position: 3 },
            { name: "Descartado", color: "#ef4444", position: 4 },
        ],
        industryFields: [
            {
                key: "operacion",
                label: "Operación",
                type: "select",
                options: ["Venta", "Arriendo", "Venta y Arriendo"],
            },
            {
                key: "habitaciones",
                label: "Habitaciones",
                type: "number",
                placeholder: "Ej: 3",
            },
            {
                key: "banos",
                label: "Baños",
                type: "number",
                placeholder: "Ej: 2",
            },
        ],
    },

    // ── E-commerce / Venta de Productos ──────────────────────
    {
        id: "ecommerce",
        label: "Venta de Productos",
        emoji: "🛍️",
        description: "E-commerce, tiendas y venta de productos físicos o digitales",
        catalogLabel: "Producto",
        defaultName: "Tu Personal Shopper",
        defaultWelcome: "¡Hola! Soy tu asistente virtual de compras. ¿Qué estás buscando hoy? 🛍️",
        systemPrompt: `Eres un personal shopper experto. Tu objetivo es recomendar el producto ideal y cerrar la venta.

PROCESO:
1. Pregunta qué está buscando o para quién es (regalo, uso personal, etc.).
2. Recomienda 1 o 2 productos del catálogo que encajen. Genera urgencia sutil si hay stock limitado.
3. Guía al cliente hacia el link de pago o cotización. Nunca menciones productos fuera del catálogo.

TONO: Entusiasta pero honesto. Cercano, como un amigo con buen gusto. Usa emojis ocasionalmente. Responde en español.`,
        stages: [
            { name: "Interesado", color: "#6366f1", position: 0 },
            { name: "Cotización Enviada", color: "#f59e0b", position: 1 },
            { name: "Pedido Confirmado", color: "#10b981", position: 2 },
            { name: "Entregado", color: "#3b82f6", position: 3 },
            { name: "Cancelado", color: "#ef4444", position: 4 },
        ],
        industryFields: [
            {
                key: "stock",
                label: "Stock disponible",
                type: "number",
                placeholder: "Ej: 15",
            },
            {
                key: "tallas",
                label: "Tallas disponibles",
                type: "text",
                placeholder: "Ej: S, M, L, XL",
            },
        ],
    },

    // ── En Blanco ─────────────────────────────────────────────
    {
        id: "blank",
        label: "En Blanco",
        emoji: "📝",
        description: "Empieza desde cero con tu propio prompt",
        catalogLabel: "Ítem",
        defaultName: "Tu Asistente Virtual",
        defaultWelcome: "¡Hola! Soy tu asistente virtual. ¿En qué puedo ayudarte hoy?",
        systemPrompt: "",
        stages: [
            { name: "Nuevo", color: "#6366f1", position: 0 },
            { name: "En Proceso", color: "#f59e0b", position: 1 },
            { name: "Cerrado", color: "#10b981", position: 2 },
        ],
        industryFields: [],
    },
];

export function getTemplate(id: string): IndustryTemplate | undefined {
    return INDUSTRY_TEMPLATES.find((t) => t.id === id);
}

/**
 * Industries where obtaining the client's name BEFORE confirming
 * an appointment is a hard requirement. A CRM entry without a name
 * is considered invalid in these verticals.
 */
export const CRITICAL_APPOINTMENT_INDUSTRIES: ReadonlySet<string> = new Set([
    "real_estate",  // Inmobiliaria
    "hair_salon",   // Peluquería / Salón
]);

/** Returns true if the given industry template ID requires the bot
 *  to capture the client name before booking any appointment. */
export function isAppointmentCriticalIndustry(industryId?: string | null): boolean {
    if (!industryId) return false;
    return CRITICAL_APPOINTMENT_INDUSTRIES.has(industryId);
}
