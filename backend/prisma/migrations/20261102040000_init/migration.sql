-- Pilot System v3.1 — initial migration (Sprint 1, PB-04)
-- Matches backend/prisma/schema.prisma table by table, column by column.
-- PostgreSQL 16. Prisma 5 style.
--
-- MIGRATION STATUS: VALIDATED-ONLY — NOT APPLIED TO ANY LIVE DATABASE.
-- This environment has NO local PostgreSQL and NO Docker, so this SQL has
-- NOT been run against a live Postgres instance. It was cross-checked
-- against schema.prisma manually (see Sprint 1 report) and, where the
-- network allowed, through `prisma validate` / `prisma generate` on the
-- schema file. Do NOT describe this migration as "applied" until it has
-- actually been applied to Development PostgreSQL and its output recorded.
--
-- APPEND-ONLY / IMMUTABILITY ENFORCEMENT (database level, not app-only):
--   * audit_events: trigger audit_events_immutable raises an exception on
--     ANY UPDATE or DELETE.
--   * contract_versions: trigger contract_versions_immutable raises an
--     exception on ANY UPDATE or DELETE. A new version is a NEW ROW;
--     superseding only sets superseded_by on... NO — see note below.
--     Correction: because UPDATE is blocked, superseded_by can NEVER be
--     set after insert. The superseding row therefore records the link in
--     the OTHER direction in application logic: the NEW row's creation is
--     the superseding fact, and readers determine "current" as the highest
--     version_number per transaction. The superseded_by column remains
--     in the schema for the case where the superseding version is known
--     at insert time (it is normally NULL, and Sprint 2 must NOT rely on
--     updating it). If Sprint 2 review finds this column unusable under
--     immutability, the column must be removed by a NEW migration with a
--     written note — it must never be "fixed" by allowing UPDATEs.
--   * Owner/superuser bypass caveat: a trigger does not stop a database
--     owner or superuser. At deployment (Sprint 5) the application must
--     connect as a dedicated non-owner role with UPDATE/DELETE revoked on
--     audit_events and contract_versions. That revoke is deployment
--     configuration (role name unknown in Sprint 1) and is NOT in this file.
--   * Separation of duties is NOT enforced here (see schema.prisma header):
--     it compares staff ids across two tables and is a Sprint 2/3 backend
--     Guard + test. This migration makes no claim otherwise.
--
-- SECRETS: none. No values, tokens, numbers, passwords or keys in this file.
-- No demo/seed rows are inserted by this migration.

-- Enums (TransactionState: exactly the 15 states, CORE PROMPT §8 order)
CREATE TYPE "TransactionState" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'ACCEPTED', 'AWAITING_FUNDING_CONFIRMATION', 'FUNDED_CONFIRMED', 'IN_FULFILMENT', 'DELIVERED', 'RECEIPT_CONFIRMED', 'SETTLEMENT_PENDING', 'SETTLED', 'DISPUTED', 'REFUND_PENDING', 'REFUNDED', 'COMPLETED', 'CANCELLED');
CREATE TYPE "UserStatus" AS ENUM ('APPROVED', 'NOT_APPROVED', 'SUSPENDED');
CREATE TYPE "PartyRole" AS ENUM ('BUYER', 'SELLER');
CREATE TYPE "EvidenceStatus" AS ENUM ('PAYMENT_EVIDENCE_SUBMITTED');
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'RESOLVED');
CREATE TYPE "DisputeResolutionOutcome" AS ENUM ('REFUND', 'PROCEED', 'CANCELLED');
CREATE TYPE "DeliveryEventType" AS ENUM ('SELLER_ARRIVED_AT_DELIVERY_POINT', 'HANDOVER_READINESS_NOTIFIED', 'BUYER_ARRIVED_AT_HANDOVER', 'HANDOVER_INSPECTION_COMPLETED', 'OPERATIONAL_EXCEPTION_PRODUCT_ABSENT');
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');
CREATE TYPE "MessageStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED');
CREATE TYPE "TemplateApproval" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- users
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "whatsapp_number" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'NOT_APPROVED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "users_whatsapp_number_key" ON "users"("whatsapp_number");

-- staff_users
CREATE TABLE "staff_users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "staff_users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "staff_users_email_key" ON "staff_users"("email");

-- roles
CREATE TABLE "roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- permissions
CREATE TABLE "permissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "permissions_name_key" ON "permissions"("name");

-- transactions
CREATE TABLE "transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "state" "TransactionState" NOT NULL DEFAULT 'DRAFT',
    "amount" DECIMAL(19,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "product_description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "delivery_point" TEXT NOT NULL,
    "cancellation_terms" TEXT NOT NULL,
    "external_payment_reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- transaction_parties
CREATE TABLE "transaction_parties" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "transaction_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "PartyRole" NOT NULL,
    CONSTRAINT "transaction_parties_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "transaction_parties_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "transaction_parties_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "transaction_parties_transaction_id_role_key" ON "transaction_parties"("transaction_id", "role");

-- contract_versions (IMMUTABLE: see triggers below)
CREATE TABLE "contract_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "transaction_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL CHECK ("version_number" >= 1),
    "content_hash" TEXT NOT NULL,
    "storage_file_id" TEXT,
    "accepted_at" TIMESTAMP(3),
    "accepted_by" UUID,
    "superseded_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contract_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "contract_versions_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "contract_versions_transaction_id_version_number_key" ON "contract_versions"("transaction_id", "version_number");

-- payment_evidences
CREATE TABLE "payment_evidences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "transaction_id" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "sender_name" TEXT NOT NULL,
    "beneficiary_name_as_shown" TEXT,
    "amount" DECIMAL(19,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "external_payment_reference" TEXT NOT NULL,
    "receipt_file_id" TEXT,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_by" UUID NOT NULL,
    "status" "EvidenceStatus" NOT NULL DEFAULT 'PAYMENT_EVIDENCE_SUBMITTED',
    CONSTRAINT "payment_evidences_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_evidences_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- financial_coordination_records
CREATE TABLE "financial_coordination_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "transaction_id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "contact_method" TEXT NOT NULL,
    "message_sent" TEXT,
    "institution_response" TEXT,
    "deposit_reference" TEXT,
    "settlement_reference" TEXT,
    "institution_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "financial_coordination_records_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "financial_coordination_records_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "financial_coordination_records_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
-- Nullable UNIQUE: one Financial Institution Deposit Reference confirms
-- funding for at most one transaction. Duplicate non-NULL values fail here
-- and must surface to staff for manual review (never auto-resolved).
CREATE UNIQUE INDEX "financial_coordination_records_deposit_reference_key" ON "financial_coordination_records"("deposit_reference");

-- delivery_events
CREATE TABLE "delivery_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "transaction_id" UUID NOT NULL,
    "event_type" "DeliveryEventType" NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recorded_by" UUID NOT NULL,
    "note" TEXT,
    CONSTRAINT "delivery_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "delivery_events_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- disputes
CREATE TABLE "disputes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "transaction_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence_file_ids" TEXT[] NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolution_outcome" "DisputeResolutionOutcome",
    "resolved_by" UUID,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "disputes_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- settlement_summaries
CREATE TABLE "settlement_summaries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "transaction_id" UUID NOT NULL,
    "deposit_reference" TEXT NOT NULL,
    "settlement_reference" TEXT NOT NULL,
    "amount" DECIMAL(19,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "beneficiary_name" TEXT NOT NULL,
    "delivery_proof_or_dispute_outcome" TEXT NOT NULL,
    "prepared_by" UUID NOT NULL,
    "prepared_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "institution_confirmation_at" TIMESTAMP(3),
    CONSTRAINT "settlement_summaries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "settlement_summaries_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "settlement_summaries_prepared_by_fkey" FOREIGN KEY ("prepared_by") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- audit_events (APPEND-ONLY: see triggers below)
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "correlation_id" UUID NOT NULL,
    "transaction_id" UUID,
    "actor_id" UUID,
    "actor_role" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "previous_state" "TransactionState",
    "new_state" "TransactionState",
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "details" JSONB,
    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "audit_events_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "audit_events_transaction_id_idx" ON "audit_events"("transaction_id");
CREATE INDEX "audit_events_correlation_id_idx" ON "audit_events"("correlation_id");

-- message_logs
CREATE TABLE "message_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "whatsapp_message_id" TEXT NOT NULL,
    "transaction_id" UUID,
    "direction" "MessageDirection" NOT NULL,
    "template_name" TEXT,
    "template_local_approval" "TemplateApproval",
    "template_meta_approval" "TemplateApproval",
    "template_rejection_reason" TEXT,
    "status" "MessageStatus" NOT NULL DEFAULT 'QUEUED',
    "is_dry_run" BOOLEAN NOT NULL DEFAULT false,
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    CONSTRAINT "message_logs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "message_logs_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "message_logs_whatsapp_message_id_key" ON "message_logs"("whatsapp_message_id");

-- role_permissions
CREATE TABLE "role_permissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "role_permissions_role_id_permission_id_key" ON "role_permissions"("role_id", "permission_id");

-- staff_user_roles
CREATE TABLE "staff_user_roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "staff_user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    CONSTRAINT "staff_user_roles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "staff_user_roles_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "staff_users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "staff_user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "staff_user_roles_staff_user_id_role_id_key" ON "staff_user_roles"("staff_user_id", "role_id");

-- ---------------------------------------------------------------------------
-- Database-level immutability triggers.
-- These raise an exception, so the offending statement FAILS — the row is
-- not silently left unchanged, and no partial write can slip through.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reject_audit_event_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only: UPDATE and DELETE are forbidden';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_immutable
BEFORE UPDATE OR DELETE ON "audit_events"
FOR EACH ROW EXECUTE FUNCTION reject_audit_event_mutation();

CREATE OR REPLACE FUNCTION reject_contract_version_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'contract_versions is immutable: UPDATE and DELETE are forbidden; create a new version instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER contract_versions_immutable
BEFORE UPDATE OR DELETE ON "contract_versions"
FOR EACH ROW EXECUTE FUNCTION reject_contract_version_mutation();
