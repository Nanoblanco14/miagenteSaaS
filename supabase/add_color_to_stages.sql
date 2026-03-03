-- ═══════════════════════════════════════════════════════════
-- Migration: Add color column to pipeline_stages
-- Run this in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════

ALTER TABLE pipeline_stages
ADD COLUMN IF NOT EXISTS color TEXT DEFAULT NULL;

-- Optional: set default colors for existing stages
-- UPDATE pipeline_stages SET color = '#3b82f6' WHERE position = 0 AND color IS NULL;
-- UPDATE pipeline_stages SET color = '#f59e0b' WHERE position = 1 AND color IS NULL;
-- UPDATE pipeline_stages SET color = '#7c3aed' WHERE position = 2 AND color IS NULL;
-- UPDATE pipeline_stages SET color = '#10b981' WHERE position = 3 AND color IS NULL;
