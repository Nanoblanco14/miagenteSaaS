-- ============================================================
-- SaaS Multi-Tenant AI Agent Platform — Database Schema
-- Run this in Supabase SQL Editor (after enabling pgvector)
-- ============================================================

-- Prerequisite: CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- 1. ORGANIZATIONS (Multi-tenancy root)
-- ============================================================
CREATE TABLE organizations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  logo_url    TEXT,
  settings    JSONB DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_organizations_slug ON organizations(slug);

-- ============================================================
-- 2. ORG_MEMBERS (Links Supabase Auth users → orgs)
-- ============================================================
CREATE TABLE org_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('owner','admin','viewer')),
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(organization_id, user_id)
);

CREATE INDEX idx_org_members_user ON org_members(user_id);
CREATE INDEX idx_org_members_org  ON org_members(organization_id);

-- ============================================================
-- 3. AGENTS (Per-organization AI agents)
-- ============================================================
CREATE TABLE agents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  system_prompt   TEXT DEFAULT '',
  personality     TEXT DEFAULT 'professional',
  language        TEXT DEFAULT 'es',
  temperature     REAL DEFAULT 0.7,
  max_tokens      INTEGER DEFAULT 1024,
  welcome_message TEXT DEFAULT '¡Hola! ¿En qué puedo ayudarte?',
  whatsapp_config JSONB DEFAULT '{}'::jsonb,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_agents_org ON agents(organization_id);

-- ============================================================
-- 4. PRODUCTS (Product-agnostic with JSONB + vector)
-- ============================================================
CREATE TABLE products (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT DEFAULT '',
  attributes      JSONB DEFAULT '{}'::jsonb,
  status          TEXT DEFAULT 'active' CHECK (status IN ('active','inactive','archived')),
  embedding       vector(1536),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_products_org    ON products(organization_id);
CREATE INDEX idx_products_status ON products(organization_id, status);
CREATE INDEX idx_products_attrs  ON products USING gin(attributes);

-- ============================================================
-- 5. PRODUCT_FILES (Images, PDFs, docs linked to products)
-- ============================================================
CREATE TABLE product_files (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  file_type   TEXT NOT NULL CHECK (file_type IN ('image','pdf','document')),
  file_url    TEXT NOT NULL,
  file_name   TEXT NOT NULL,
  file_size   INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_pfiles_product ON product_files(product_id);

-- ============================================================
-- 6. CONVERSATIONS
-- ============================================================
CREATE TABLE conversations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id     UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  client_phone TEXT NOT NULL,
  client_name  TEXT DEFAULT '',
  status       TEXT DEFAULT 'active' CHECK (status IN ('active','lead','closed')),
  metadata     JSONB DEFAULT '{}'::jsonb,
  started_at   TIMESTAMPTZ DEFAULT now(),
  last_message_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_convos_agent  ON conversations(agent_id);
CREATE INDEX idx_convos_phone  ON conversations(client_phone);
CREATE INDEX idx_convos_status ON conversations(agent_id, status);

-- ============================================================
-- 7. MESSAGES
-- ============================================================
CREATE TABLE messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content         TEXT NOT NULL,
  media_url       TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_messages_convo ON messages(conversation_id, created_at);

-- ============================================================
-- 8. RPC: Semantic search with org-scoped cosine similarity
-- ============================================================
CREATE OR REPLACE FUNCTION match_products(
  query_embedding vector(1536),
  match_org_id    UUID,
  match_threshold FLOAT DEFAULT 0.5,
  match_count     INT DEFAULT 10
)
RETURNS TABLE (
  id          UUID,
  name        TEXT,
  description TEXT,
  attributes  JSONB,
  similarity  FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.name,
    p.description,
    p.attributes,
    1 - (p.embedding <=> query_embedding) AS similarity
  FROM products p
  WHERE p.organization_id = match_org_id
    AND p.status = 'active'
    AND p.embedding IS NOT NULL
    AND 1 - (p.embedding <=> query_embedding) > match_threshold
  ORDER BY p.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ============================================================
-- 9. Auto-update "updated_at" trigger
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_organizations_updated BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_agents_updated BEFORE UPDATE ON agents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_products_updated BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 10. Row Level Security (RLS)
-- ============================================================
ALTER TABLE organizations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_members     ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents          ENABLE ROW LEVEL SECURITY;
ALTER TABLE products        ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_files   ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages        ENABLE ROW LEVEL SECURITY;

-- Org members can read their own organizations
CREATE POLICY "Members can view own org"
  ON organizations FOR SELECT
  USING (id IN (SELECT organization_id FROM org_members WHERE user_id = auth.uid()));

-- Org members can manage members
CREATE POLICY "Members can view org members"
  ON org_members FOR SELECT
  USING (organization_id IN (SELECT organization_id FROM org_members WHERE user_id = auth.uid()));

-- Agents: full access for org members
CREATE POLICY "Org members manage agents"
  ON agents FOR ALL
  USING (organization_id IN (SELECT organization_id FROM org_members WHERE user_id = auth.uid()));

-- Products: full access for org members
CREATE POLICY "Org members manage products"
  ON products FOR ALL
  USING (organization_id IN (SELECT organization_id FROM org_members WHERE user_id = auth.uid()));

-- Product files: access through product ownership
CREATE POLICY "Org members manage product files"
  ON product_files FOR ALL
  USING (product_id IN (
    SELECT id FROM products WHERE organization_id IN (
      SELECT organization_id FROM org_members WHERE user_id = auth.uid()
    )
  ));

-- Conversations: access through agent ownership
CREATE POLICY "Org members view conversations"
  ON conversations FOR ALL
  USING (agent_id IN (
    SELECT id FROM agents WHERE organization_id IN (
      SELECT organization_id FROM org_members WHERE user_id = auth.uid()
    )
  ));

-- Messages: access through conversation ownership
CREATE POLICY "Org members view messages"
  ON messages FOR ALL
  USING (conversation_id IN (
    SELECT id FROM conversations WHERE agent_id IN (
      SELECT id FROM agents WHERE organization_id IN (
        SELECT organization_id FROM org_members WHERE user_id = auth.uid()
      )
    )
  ));
