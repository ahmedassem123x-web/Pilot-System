-- Pilot System v3.1 — second migration (post-UAT fix for OBS-1)
-- Adds the FollowUpCase model to backend/prisma/schema.prisma.
-- A follow-up case is staff work only: it changes NO transaction state,
-- NO money, and NO beneficiary. It is created when a beneficiary change
-- from a WhatsApp message alone is rejected (settlement path D2).
--
-- MIGRATION STATUS: VALIDATED-ONLY — NOT APPLIED TO ANY LIVE DATABASE.
-- Same honesty as the Sprint 1 migration: this SQL has NOT been run
-- against a live PostgreSQL instance in this environment. It was
-- cross-checked against schema.prisma by hand (table, columns, types,
-- defaults, foreign key). Do NOT describe this migration as "applied"
-- until it has actually been applied to Development PostgreSQL and its
-- output recorded.

-- CreateEnum
CREATE TYPE "FollowUpCaseType" AS ENUM ('BENEFICIARY_DISCREPANCY');

-- CreateEnum
CREATE TYPE "FollowUpCaseStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateTable
CREATE TABLE "follow_up_cases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "transaction_id" UUID NOT NULL,
    "type" "FollowUpCaseType" NOT NULL,
    "status" "FollowUpCaseStatus" NOT NULL DEFAULT 'OPEN',
    "details" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_by" UUID,
    "resolved_at" TIMESTAMP(3),
    "resolution" TEXT,

    CONSTRAINT "follow_up_cases_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "follow_up_cases_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
