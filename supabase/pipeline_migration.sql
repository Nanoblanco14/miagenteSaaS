-- ============================================================
-- Pipeline de Ventas — Migration
-- Run this in Supabase SQL Editor
-- ============================================================

-- ============================================================
-- 1. PIPELINE_STAGES (Kanban columns per organization)
-- ============================================================
CREATE TABLE pipeline_stages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  position        INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_pipeline_stages_org ON pipeline_stages(organization_id);

-- ============================================================
-- 2. LEADS (Cards on the Kanban board)
-- ============================================================
CREATE TABLE leads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  stage_id        UUID NOT NULL REFERENCES pipeline_stages(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  email           TEXT DEFAULT '',
  phone           TEXT DEFAULT '',
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_leads_org   ON leads(organization_id);
CREATE INDEX idx_leads_stage ON leads(stage_id);

-- ============================================================
-- 3. TRIGGER: Auto-create default stages for new organizations
-- ============================================================
CREATE OR REPLACE FUNCTION create_default_pipeline_stages()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO pipeline_stages (organization_id, name, position) VALUES
    (NEW.id, 'Nuevo Lead',       0),
    (NEW.id, 'Interesado',       1),
    (NEW.id, 'Visita Agendada',  2),
    (NEW.id, 'Cierre/Venta',     3);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_org_default_pipeline
  AFTER INSERT ON organizations
  FOR EACH ROW
  EXECUTE FUNCTION create_default_pipeline_stages();

-- ============================================================
-- 4. SEED: Create default stages for existing organizations
--    (only if they don't already have any stages)
-- ============================================================
INSERT INTO pipeline_stages (organization_id, name, position)
SELECT o.id, s.name, s.position
FROM organizations o
CROSS JOIN (
  VALUES
    ('Nuevo Lead',      0),
    ('Interesado',      1),
    ('Visita Agendada', 2),
    ('Cierre/Venta',    3)
) AS s(name, position)
WHERE NOT EXISTS (
  SELECT 1 FROM pipeline_stages ps WHERE ps.organization_id = o.id
);

-- ============================================================
-- 5. ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE pipeline_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads           ENABLE ROW LEVEL SECURITY;

-- Pipeline stages: full access for org members
CREATE POLICY "Org members manage pipeline stages"
  ON pipeline_stages FOR ALL
  USING (organization_id IN (
    SELECT organization_id FROM org_members WHERE user_id = auth.uid()
  ));

-- Leads: full access for org members
CREATE POLICY "Org members manage leads"
  ON leads FOR ALL
  USING (organization_id IN (
    SELECT organization_id FROM org_members WHERE user_id = auth.uid()
  ));
