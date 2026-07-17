-- ============================================================
-- Fix incidente 2026-07-15: "los chats no aparecen, el mensaje
-- no entra y el bot no contesta".
--
-- Ejecutar en Supabase → SQL Editor. Cada bloque es idempotente
-- y se puede correr por separado. LEE LOS COMENTARIOS.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 0) DIAGNÓSTICO — corre esto PRIMERO y mira los resultados.
--    Confirma la causa raíz más probable: el plan quedó en 'free'
--    (máx. 50 leads) y la org ya superó ese tope, por lo que el
--    webhook descartaba en silencio todo número nuevo.
-- ────────────────────────────────────────────────────────────
SELECT
  o.id            AS organization_id,
  o.name,
  o.plan,
  COUNT(l.id)                                   AS total_leads,
  COUNT(l.id) FILTER (WHERE l.is_bot_paused)    AS leads_con_bot_pausado,
  COUNT(l.id) FILTER (WHERE l.source = 'whatsapp') AS leads_whatsapp
FROM organizations o
LEFT JOIN leads l ON l.organization_id = o.id
GROUP BY o.id, o.name, o.plan
ORDER BY total_leads DESC;

-- ¿Hay leads con stage_id inválido (vacío) que no aparecen en el inbox?
SELECT id, name, phone, stage_id, source, is_bot_paused, created_at
FROM leads
WHERE stage_id IS NULL OR stage_id::text = ''
ORDER BY created_at DESC
LIMIT 50;


-- ────────────────────────────────────────────────────────────
-- 1) SUBIR EL PLAN de tu organización  ← ARREGLO INMEDIATO
--    Reemplaza el UUID por tu organization_id del diagnóstico (0).
--    'business' = 5000 leads / 5000 conversaciones.
-- ────────────────────────────────────────────────────────────
-- UPDATE organizations SET plan = 'business'
-- WHERE id = 'PEGA-AQUI-TU-ORGANIZATION-ID';


-- ────────────────────────────────────────────────────────────
-- 2) REACTIVAR el bot en leads que quedaron pausados por error
--    (cada respuesta manual desde el inbox pausaba el bot para
--    ese lead y NO se reactivaba solo). Descomenta para aplicar.
-- ────────────────────────────────────────────────────────────
-- UPDATE leads SET is_bot_paused = false
-- WHERE organization_id = 'PEGA-AQUI-TU-ORGANIZATION-ID'
--   AND is_bot_paused = true;


-- ────────────────────────────────────────────────────────────
-- 3) REALTIME — el inbox se actualiza en vivo vía Supabase
--    Realtime. Si estas tablas no están en la publicación, los
--    chats nuevos no aparecen sin recargar. Idempotente.
-- ────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'lead_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE lead_messages;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'leads'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE leads;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────
-- 4) Arreglar la migración rota de template_send_log.
--    La versión original referenciaba una tabla `profiles` que no
--    existe → la migración fallaba entera y la tabla nunca se creó,
--    dejando el log de plantillas (anti-spam) sin funcionar.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS template_send_log (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    event text NOT NULL,
    template_name text NOT NULL,
    parameters jsonb DEFAULT '[]'::jsonb,
    sent_at timestamptz DEFAULT now(),
    success boolean DEFAULT true,
    error text
);

CREATE INDEX IF NOT EXISTS idx_tsl_lead_event ON template_send_log(lead_id, event, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_tsl_lead_date  ON template_send_log(lead_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_tsl_org        ON template_send_log(organization_id, sent_at DESC);

ALTER TABLE template_send_log ENABLE ROW LEVEL SECURITY;

-- La policy original referenciaba `profiles` (tabla inexistente) → fallaba
-- toda la migración. Aquí se usa org_members, que sí existe.
DROP POLICY IF EXISTS "Users can view template logs for their org" ON template_send_log;
CREATE POLICY "Users can view template logs for their org"
    ON template_send_log FOR SELECT
    USING (organization_id IN (
        SELECT organization_id FROM org_members WHERE user_id = auth.uid()
    ));
