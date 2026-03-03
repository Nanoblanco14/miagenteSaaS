-- ============================================================
-- Human Takeover & Spy Mode — Migration
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. Add bot-pause flag to leads
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS is_bot_paused BOOLEAN NOT NULL DEFAULT false;

-- 2. New table: lead_messages
--    Linked directly to leads (no conversation indirection needed)
CREATE TABLE IF NOT EXISTS lead_messages (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id    UUID        NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  role       TEXT        NOT NULL CHECK (role IN ('user', 'assistant')),
  content    TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_messages_lead
  ON lead_messages(lead_id, created_at);

-- 3. Row Level Security
ALTER TABLE lead_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members manage lead_messages"
  ON lead_messages FOR ALL
  USING (
    lead_id IN (
      SELECT id FROM leads
      WHERE organization_id IN (
        SELECT organization_id FROM org_members
        WHERE user_id = auth.uid()
      )
    )
  );
