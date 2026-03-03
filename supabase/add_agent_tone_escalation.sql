-- =========================================================
-- Migration: Add conversation_tone + escalation_rule to agents
-- Run in: Supabase SQL Editor
-- =========================================================

-- 1. Add conversation_tone column (nullable TEXT)
ALTER TABLE agents
    ADD COLUMN IF NOT EXISTS conversation_tone TEXT
        CHECK (conversation_tone IN (
            'Profesional y Formal',
            'Amigable y Casual',
            'Entusiasta y Vendedor'
        ));

-- 2. Add escalation_rule column (nullable TEXT, free-form)
ALTER TABLE agents
    ADD COLUMN IF NOT EXISTS escalation_rule TEXT;

-- 3. Set default tone for existing rows (optional but recommended)
UPDATE agents
    SET conversation_tone = 'Profesional y Formal'
    WHERE conversation_tone IS NULL;

-- =========================================================
-- Verification: check columns were added correctly
-- =========================================================
SELECT
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'agents'
  AND column_name IN ('conversation_tone', 'escalation_rule')
ORDER BY column_name;
