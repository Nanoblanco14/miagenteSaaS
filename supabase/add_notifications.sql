-- ============================================================
-- Migration: notifications table for in-app handoff alerts
-- Run in Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lead_id     UUID REFERENCES leads(id) ON DELETE SET NULL,
  type        TEXT NOT NULL DEFAULT 'handoff',
  message     TEXT NOT NULL,
  is_read     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_tenant
  ON notifications(tenant_id, is_read, created_at DESC);

-- ── Row Level Security ───────────────────────────────────────
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Org members can read their own notifications
CREATE POLICY "Members read own notifications"
  ON notifications FOR SELECT
  USING (
    tenant_id IN (
      SELECT organization_id FROM org_members WHERE user_id = auth.uid()
    )
  );

-- Org members can mark notifications as read
CREATE POLICY "Members update own notifications"
  ON notifications FOR UPDATE
  USING (
    tenant_id IN (
      SELECT organization_id FROM org_members WHERE user_id = auth.uid()
    )
  );

-- Service role (webhook) can insert without RLS restriction
-- (service_role key bypasses RLS by default in Supabase)
