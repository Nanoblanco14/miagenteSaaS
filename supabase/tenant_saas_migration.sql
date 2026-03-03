-- ============================================================
-- Fase 1 SaaS Multi-Tenant — Migration
-- Agrega campos de credenciales a organizations para que
-- cada tenant configure su propio bot sin tocar código.
-- Ejecutar en Supabase SQL Editor.
-- ============================================================

-- 1. API Key de OpenAI por tenant
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS openai_api_key TEXT DEFAULT '';

-- 2. Proveedor de WhatsApp (twilio o meta)
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS whatsapp_provider TEXT DEFAULT 'twilio'
  CHECK (whatsapp_provider IN ('twilio', 'meta'));

-- 3. Credenciales del proveedor en formato JSONB
--    Twilio: { "account_sid": "...", "auth_token": "...", "phone_number": "..." }
--    Meta:   { "phone_number_id": "...", "access_token": "...", "verify_token": "...", "business_account_id": "..." }
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS whatsapp_credentials JSONB DEFAULT '{}'::jsonb;
