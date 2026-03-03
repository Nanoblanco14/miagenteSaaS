-- ============================================================
-- Migration: Add scraped_context to agents table
-- Run in Supabase SQL Editor
-- ============================================================

ALTER TABLE agents
ADD COLUMN IF NOT EXISTS scraped_context TEXT;

COMMENT ON COLUMN agents.scraped_context IS
  'Extracted plain text from tenant URLs, injected into the AI system prompt as additional company knowledge.';
