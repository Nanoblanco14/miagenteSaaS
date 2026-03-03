import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

// 1. Clientes de BD y de IA
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

        console.log(`📩 WhatsApp de ${sender}: ${incomingMsg}`);

        // ==========================================
        // 🤖 2. EL CEREBRO DE LA IA (EL PROMPT)
        // ==========================================
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

        // 3. Llamada a OpenAI (Usamos gpt-4o-mini porque es rapidísimo y barato)
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: incomingMsg } // Lo que escribió el cliente
            ],
        });

        const botResponse = completion.choices[0].message.content || "Lo siento, estoy teniendo problemas técnicos.";

        // ==========================================
        // 📊 4. LÓGICA DE NEGOCIO (CRM)
        // ==========================================
        // TRUCO: Si la IA decidió entregar el link de Calendly en su respuesta, 
        // significa que el cliente pasó el filtro. ¡Ahí lo guardamos en el Pipeline!

        const saveLead = botResponse.includes('calendly.com');

        if (saveLead) {
            const orgId = '2f02b760-63fc-4dba-a587-92e550c1d846'; // <-- ¡NO OLVIDES CAMBIAR ESTO!

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
            console.log("✅ ¡Cliente calificado y guardado en el CRM!");
        }

        // 5. Enviar la respuesta inteligente a Twilio/WhatsApp
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
        console.error("Error en el servidor:", error);
        return new Response("Error", { status: 500 });
    }
}