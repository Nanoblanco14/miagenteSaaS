-- ============================================================
-- Migration: Add booking_url to agents table
-- Allows agents to share a calendar link for scheduling visits.
-- Run this in Supabase SQL Editor.
-- ============================================================

ALTER TABLE agents ADD COLUMN IF NOT EXISTS booking_url text;

COMMENT ON COLUMN agents.booking_url IS 'Calendar booking link (Cal.com, Calendly, Google Calendar, etc.)';
