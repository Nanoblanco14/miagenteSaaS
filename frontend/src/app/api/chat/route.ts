// ═══════════════════════════════════════════════════════════════
// ⚠️ LEGACY — Webhook simple de Twilio (single-tenant).
// Para multi-tenant usar: /api/webhook/[tenantId]
// ═══════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
    try {
        const formData = await req.formData();
        const incomingMsg = formData.get('Body')?.toString() || '';
        const sender = formData.get('From')?.toString() || '';

        const orgId = process.env.DEFAULT_ORG_ID;
        if (!orgId) {
            console.error("DEFAULT_ORG_ID no configurado en variables de entorno");
            return new Response("Config error", { status: 500 });
        }

        console.log(`[chat] WhatsApp de ${sender}: ${incomingMsg}`);

        const systemPrompt = `
      Eres el asistente virtual estrella de una inmobiliaria. Tu objetivo es pre-calificar a los clientes que llegan por WhatsApp.

      Reglas estrictas:
      1. Tus respuestas deben ser MUY breves (máximo 2 párrafos cortos). Recuerda que estás en WhatsApp.
      2. Sé amable, profesional y persuasivo.
      3. Si el cliente solo saluda, pregúntale en qué comuna o sector busca propiedad y si es para comprar o arrendar.
      4. Si ya sabes qué busca, pregúntale cuál es su presupuesto estimado.
      5. Si el cliente ya te dio su presupuesto y se muestra interesado, dile que cumple con el perfil, que un ejecutivo experto lo contactará, y entrégale ESTE ENLACE para agendar una cita: https://calendly.com/tu-link-de-prueba
      6. NUNCA inventes precios exactos ni nombres de propiedades específicas.
    `;

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: incomingMsg }
            ],
        });

        const botResponse = completion.choices[0].message.content || "Lo siento, estoy teniendo problemas técnicos.";

        const saveLead = botResponse.includes('calendly.com');

        if (saveLead) {
            const { data: stages } = await supabase.from('pipeline_stages')
                .select('id').eq('organization_id', orgId).limit(1);
            const stageId = stages?.[0]?.id;

            await supabase.from('leads').insert({
                organization_id: orgId,
                name: 'Lead Calificado (WhatsApp)',
                phone: sender.replace('whatsapp:', ''),
                notes: `Último mensaje: ${incomingMsg}`,
                stage_id: stageId
            });
            console.log("[chat] Cliente calificado y guardado en el CRM");
        }

        const xmlResponse = `
    <?xml version="1.0" encoding="UTF-8"?>
    <Response>
        <Message>${botResponse}</Message>
    </Response>
    `;

        return new Response(xmlResponse, {
            headers: { 'Content-Type': 'text/xml' },
        });

    } catch (error) {
        console.error("[chat] Error en el servidor:", error);
        return new Response("Error", { status: 500 });
    }
}