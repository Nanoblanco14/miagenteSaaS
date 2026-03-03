-- ============================================================
-- Tabla: agents
-- Almacena la configuración del agente AI por organización.
-- Ejecutar en Supabase SQL Editor si la tabla no existe.
-- ============================================================

CREATE TABLE IF NOT EXISTS agents (
    id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at      timestamptz DEFAULT now(),
    updated_at      timestamptz DEFAULT now(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name            text NOT NULL DEFAULT 'Agente de Ventas',
    system_prompt   text NOT NULL DEFAULT 'Eres un asistente experto inmobiliario. Responde SOLO basándote en el contexto proporcionado. Si no tienes información suficiente, dilo honestamente.',
    welcome_message text NOT NULL DEFAULT '¡Hola! Soy tu asistente inmobiliario. ¿En qué puedo ayudarte hoy?',
    model           text NOT NULL DEFAULT 'gpt-4o-mini',
    personality     text NOT NULL DEFAULT 'professional',
    language        text NOT NULL DEFAULT 'es',
    temperature     real NOT NULL DEFAULT 0.7,
    max_tokens      integer NOT NULL DEFAULT 1024,
    whatsapp_config jsonb NOT NULL DEFAULT '{}',
    booking_url     text,
    is_active       boolean NOT NULL DEFAULT true
);

-- Índice para buscar agentes por organización
CREATE INDEX IF NOT EXISTS idx_agents_org ON agents(organization_id);

-- RLS: solo miembros de la org pueden ver/editar sus agentes
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can manage their org agents"
ON agents FOR ALL
USING (
    organization_id IN (
        SELECT organization_id FROM org_members WHERE user_id = auth.uid()
    )
);
