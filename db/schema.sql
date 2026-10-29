-- Pilot System — مخطط قاعدة البيانات (PostgreSQL 16)
-- قواعد ثابتة: سجل التدقيق إلحاقي فقط، الحذف منطقي لا فيزيائي،
-- لا تأكيد مالي بدون مرجع مؤسسة، ولا عمود رصيد داخلي أبداً.
-- NOTE (Stage 4/6): the runtime store TODAY is the JSON file
-- (backend/src/data.json); this schema is the PRODUCTION Postgres
-- target, not the live store. The additive WhatsApp notes at the end
-- of this file describe columns to add at Postgres switch-on only;
-- they do not change any of the 12 tables below.

-- Departments are a fixed enumeration (no separate table, so the schema
-- keeps its 12 tables): Operations, Finance Coordination, Customer
-- Support, Administration. The API exposes them at GET /api/departments.
CREATE TABLE app_users (
  id SERIAL PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  -- scrypt hash ONLY, format 'scrypt:<salt>:<hash>'. Plaintext passwords
  -- are never stored, returned, or written to any file.
  password_hash TEXT,
  role TEXT NOT NULL CHECK (role IN ('owner','ops_supervisor','ops_employee','financial_coordinator','viewer')),
  department TEXT CHECK (department IN ('Operations','Finance Coordination','Customer Support','Administration')),
  -- Per-user overrides that restrict/replace the role defaults. An empty
  -- sections array / empty actions object means "use the role defaults"
  -- (the API applies the same rule to legacy rows with NULLs).
  sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  actions JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_primary_admin BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
-- The primary admin (is_primary_admin) must never be disabled or deleted,
-- and the only active owner must never be disabled or deleted; both guards
-- live in the API, not in the schema, because they depend on live counts.

CREATE TABLE contracts (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  buyer_phone TEXT NOT NULL,
  seller_phone TEXT NOT NULL,
  product_description TEXT NOT NULL,
  amount NUMERIC(19,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'SAR',
  delivery_point TEXT,
  acceptance_deadline TIMESTAMPTZ,
  state TEXT NOT NULL DEFAULT 'draft',
  clause_fingerprint TEXT,
  created_by INTEGER REFERENCES app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE contract_versions (
  id SERIAL PRIMARY KEY,
  contract_id INTEGER NOT NULL REFERENCES contracts(id),
  version_no INTEGER NOT NULL,
  clauses_json JSONB NOT NULL,
  fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE contract_files (
  id SERIAL PRIMARY KEY,
  contract_id INTEGER NOT NULL REFERENCES contracts(id),
  kind TEXT NOT NULL CHECK (kind IN ('original','buyer_signed','seller_signed','attachment')),
  file_url TEXT NOT NULL,
  uploaded_by INTEGER REFERENCES app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE conversations (
  id SERIAL PRIMARY KEY,
  contract_id INTEGER NOT NULL REFERENCES contracts(id),
  party TEXT NOT NULL CHECK (party IN ('buyer','seller')),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','open','waiting','closed')),
  assigned_to INTEGER REFERENCES app_users(id),
  unread_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE messages (
  id SERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  sender_name TEXT,
  body TEXT NOT NULL,
  template_name TEXT,
  is_internal_note BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ops_tasks (
  id SERIAL PRIMARY KEY,
  contract_id INTEGER REFERENCES contracts(id),
  title TEXT NOT NULL,
  task_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled')),
  financial_reference TEXT,
  assigned_to INTEGER REFERENCES app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE workflows (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('keyword','contract_event','manual')),
  trigger_value TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE workflow_steps (
  id SERIAL PRIMARY KEY,
  workflow_id INTEGER NOT NULL REFERENCES workflows(id),
  step_order INTEGER NOT NULL,
  step_type TEXT NOT NULL,
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE whatsapp_templates (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  language TEXT NOT NULL DEFAULT 'ar',
  category TEXT NOT NULL DEFAULT 'UTILITY',
  body TEXT NOT NULL,
  approval_status TEXT NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending','approved','rejected'))
);

CREATE TABLE automation_rules (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  trigger_event TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('send_template','create_task','notify','handover')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  kill_switch_off BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE audit_log (
  id SERIAL PRIMARY KEY,
  actor_id INTEGER REFERENCES app_users(id),
  actor_name TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- لا يوجد UPDATE ولا DELETE على audit_log في كود التطبيق أبداً.

-- =====================================================================
-- Stage 4/6 (ADDITIVE ONLY, commented — apply at Postgres switch-on):
-- WhatsApp / Meta fields. Nothing below alters the 12 tables above
-- until it is deliberately applied; the runtime JSON store already
-- carries these fields with the same names and meanings.
-- ---------------------------------------------------------------------
-- whatsapp_templates: Meta's view of a template, kept SEPARATE from the
-- local approval_status (which is manual and must never be overwritten
-- by a Meta sync). meta_template_id is Meta's id when one is returned.
--   ALTER TABLE whatsapp_templates ADD COLUMN IF NOT EXISTS meta_status
--     TEXT NOT NULL DEFAULT 'not_submitted'
--     CHECK (meta_status IN ('not_submitted','pending','approved','rejected','paused','disabled'));
--   ALTER TABLE whatsapp_templates ADD COLUMN IF NOT EXISTS meta_template_id TEXT;
-- messages: wamid is Meta's message id (dedup key for inbound, status
-- key for outbound); meta_status tracks sent/delivered/read/failed for
-- outbound rows only; dry_run marks rows recorded while Meta was
-- unconfigured (never render those as sent to WhatsApp).
--   ALTER TABLE messages ADD COLUMN IF NOT EXISTS wamid TEXT UNIQUE;
--   ALTER TABLE messages ADD COLUMN IF NOT EXISTS meta_status TEXT
--     CHECK (meta_status IN ('sent','delivered','read','failed'));
--   ALTER TABLE messages ADD COLUMN IF NOT EXISTS dry_run BOOLEAN NOT NULL DEFAULT FALSE;
--   ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_phone TEXT;
--   ALTER TABLE messages ADD COLUMN IF NOT EXISTS to_phone TEXT;
--   ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_type TEXT;
-- conversations: last_inbound_at drives the 24-hour customer-service
-- window (free-form replies only within 24h of the last inbound
-- message from that phone); a GENERAL conversation has contract_id
-- NULL and party 'general' and carries the customer phone, so the
-- Postgres CHECK on party must be widened and contract_id nullable:
--   ALTER TABLE conversations ALTER COLUMN contract_id DROP NOT NULL;
--   ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_party_check;
--   ALTER TABLE conversations ADD CONSTRAINT conversations_party_check
--     CHECK (party IN ('buyer','seller','general'));
--   ALTER TABLE conversations ADD COLUMN IF NOT EXISTS phone TEXT;
--   ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_inbound_at TIMESTAMPTZ;
-- =====================================================================
