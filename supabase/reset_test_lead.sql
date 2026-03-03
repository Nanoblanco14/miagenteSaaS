-- ============================================================
-- Migration: ensure cascade cleanup when leads are deleted
-- This allows SaaS owners to wipe a test lead and start fresh
--
-- Run in Supabase SQL Editor
-- ============================================================

-- The notifications table was created with:
--   lead_id UUID REFERENCES leads(id) ON DELETE SET NULL
-- No change needed there — notifications survive lead deletion (by design).

-- ── Wipe a lead's data for testing ────────────────────────────
-- Use this function to fully reset a phone number for testing.
-- It deletes the lead AND its associated notifications (if any).
CREATE OR REPLACE FUNCTION reset_test_lead(p_phone TEXT, p_org_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_lead_id UUID;
BEGIN
  -- Find the lead
  SELECT id INTO v_lead_id
  FROM leads
  WHERE phone = p_phone AND organization_id = p_org_id
  LIMIT 1;

  IF v_lead_id IS NOT NULL THEN
    -- Delete notifications linked to this lead
    DELETE FROM notifications WHERE lead_id = v_lead_id;
    -- Delete the lead itself
    DELETE FROM leads WHERE id = v_lead_id;
  END IF;
END;
$$;

-- ── Usage example (replace values): ───────────────────────────
-- SELECT reset_test_lead('+56912345678', 'your-org-uuid-here');

-- ── NOTE on in-memory chat history ────────────────────────────
-- The AI's in-memory chatMemory in route.ts is process-scoped.
-- Restarting the Next.js server (or simply saving route.ts)
-- will clear it automatically for all numbers.
-- Deleting the lead from the pipeline UI also removes the lead
-- from the DB, so the AI will treat the next message as a brand
-- new contact (no memory from DB since history is in-memory only).
