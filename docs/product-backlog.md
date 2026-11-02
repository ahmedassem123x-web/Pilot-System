# Product Backlog — Pilot System v3.1 Rebuild (DRAFT FOR APPROVAL — NO CODE YET)
# Status: Presented 2026-11-02, awaiting Ahmed's written approval before archiving old build or writing any code.
# Governing source: CORE PROMPT (English) + client alignment MVP-TECH-2026-002 v3.1 + ORTECH-MVP-RESP-2026-001 v1.0.
# Hierarchy warning: the saved skill files were written under v1.2 (12 states, JSON file, scrypt). Where they conflict with v3.1, v3.1 WINS:
# 15 states (not 12), NestJS 10 + Prisma 5 + PostgreSQL 16 (not Node built-ins + JSON), argon2id (not scrypt),
# Redis 7 + BullMQ 5, direct Meta Cloud API, NO Control Tower.

## Product Goal
A closed, invitation-only pilot that documents a commercial agreement already made outside the system and manages its
execution lifecycle through WhatsApp only, with one lightweight internal operations panel. Money stays with an external
financial institution under manual, documented coordination. The system NEVER moves money.

## Backlog items — every item has checkable acceptance criteria; an item without them is NOT ready

### EPIC A — Foundation (Sprint 0 + Sprint 1)
- **PB-01 — Archive old build.** Acceptance: full copy in `~/workspace/pilot-system-archive-v1/` with file count verified,
  last commit recorded, `ARCHIVE-NOTE.md` written ("READ-ONLY — DO NOT DEPLOY, DO NOT PUSH"). No GitHub repo deletion,
  no force-push, no `main` replacement without Ahmed's separate explicit written confirmation.
- **PB-02 — New repository structure.** Acceptance: `~/workspace/pilot-system-v31/` with `backend/` (NestJS), `frontend/` (React+Vite),
  `docker-compose.yml`, `.env.example` (names only, zero values), README with run instructions. `npm run dev` starts backend + frontend.
- **PB-03 — Environments + CI.** Acceptance: Development / Staging / Production separated; CI runs lint + unit tests on every push;
  a failing CI blocks merge. No secrets in any file (grep-verified).
- **PB-04 — Prisma data model + migrations.** Acceptance: all tables in CORE PROMPT §7 created by migrations from zero;
  deposit-reference uniqueness enforced in the database; AuditEvent has no UPDATE/DELETE path (database-enforced, tested).
- **PB-05 — Transition matrix (Sprint 1 gate).** Acceptance: full 15-state transition matrix, every allowed transition with its Guard
  (actor, previous state, required evidence/reference, permission), every forbidden transition listed, accepted IN WRITING by Ahmed
  before any Sprint 2 code.

### EPIC B — Core transaction engine (Sprint 2)
- **PB-06 — Users + identity.** Acceptance: one permanent UUID per person linked to one WhatsApp number; same person as buyer in one
  transaction and seller in another creates NO second User row; Buyer/Seller lives ONLY in TransactionParty.
- **PB-07 — Transactions + contracts + versions.** Acceptance: create transaction, create contract version, SHA-256 fingerprint,
  previous versions preserved and never overwritten; accepted version is frozen and provable (hash + timestamp + WhatsApp messages + audit).
- **PB-08 — 15-state machine.** Acceptance: every allowed transition works end-to-end; every forbidden transition is rejected with a
  clear error code AND an audit entry; negative tests exist for every forbidden transition in the matrix.
- **PB-09 — Audit log.** Acceptance: every state change, evidence submission, coordination record, assignment, and macro run writes an
  Append-Only entry (actor, role, previous state, new state, timestamp, Correlation ID); modification attempt is rejected and tested.
- **PB-10 — Contract amendment policy.** Acceptance: before acceptance = new version, old preserved; after acceptance before funding/shipping =
  both parties' approval + new version + re-acceptance; after confirmed funding/shipping = amendment REJECTED, path is dispute or later
  documented agreement (both tested).

### EPIC C — WhatsApp channel (Sprint 2, completed in Sprint 3)
- **PB-11 — Webhook + HMAC + idempotency.** Acceptance: HMAC SHA-256 verified, constant-time compare, wrong signature REJECTED (tested);
  duplicate `whatsapp_message_id` processed with NO duplicate effect (tested); statuses never downgrade except to `failed`.
- **PB-12 — Templates + 24h window.** Acceptance: free text inside 24h, approved Utility templates only outside; local vs. Meta approval shown
  SEPARATELY; locally-approved but Meta-rejected template is UN-SENDABLE with reason visible; dry-run never claimed as sent.
- **PB-13 — WhatsApp inbox (triptych) + composer.** Acceptance: list | chat | details, full height, no cards inside workspace;
  search, filters, triage, assignment, tags, linked contract, reply/quote, internal notes as centred system notices (never sent),
  single composer; phone = list → chat → drawer; desktop = all three. Buttons ≤3, lists ≤10, trigger on button/list id, never on title text.
- **PB-14 — Test WhatsApp path + linking migration.** Acceptance: development/testing on test accounts/numbers; documented migration path
  to final Meta account/WABA/number owned by the client; admin permissions returned/handed over at delivery. No BSP in baseline.

### EPIC D — Operations panel + financial coordination (Sprint 3)
- **PB-15 — Operations panel (ONE, lightweight, staff only).** Acceptance: approve/suspend users, transaction lifecycle view, contract/evidence
  review, payment-evidence review, verification request + manual communication record, institution confirmation + deposit reference record,
  manual settlement summary, settlement/refund outcome AFTER external confirmation, dispute/exception follow-up, audit view.
- **PB-16 — Payment-instruction voucher (configurable).** Acceptance: voucher fields exactly as CORE PROMPT §11.1, configurable per institution
  approval; no single-beneficiary/single-account assumption; no detailed financial data fixed before institution approval.
- **PB-17 — Buyer evidence ≠ institution confirmation.** Acceptance: evidence recorded ONLY as `Payment Evidence Submitted`; it NEVER
  becomes funding confirmation and NEVER permits shipping (both tested, in UI wording, data model, and tests).
- **PB-18 — Manual verification path.** Acceptance: staff flow review → manual institution contact → send accepted information → request
  verification → record response + reference; system collects/withdraws/deposits NOTHING (negative test).
- **PB-19 — Four financial references.** Acceptance: Transaction ID, External Payment Reference, Financial Institution Deposit Reference,
  Financial Institution Settlement Reference — separate fields, linked to the same transaction; deposit reference unique across transactions;
  duplicate/conflict surfaces to staff for manual review; `FUNDED_CONFIRMED` ONLY with institution confirmation + deposit reference (Guard tested).
- **PB-20 — Settlement + beneficiary protection.** Acceptance: settlement summary prepared manually by staff; beneficiary/destination NEVER
  changed from a WhatsApp message alone (negative test); discrepancy = follow-up case; settlement/refund recorded as EXECUTED only after
  institution confirmation, with all fields in CORE PROMPT §11.5.
- **PB-21 — Sold as Seen handover.** Acceptance: exact 6-step sequence (seller arrival → readiness notice → BUYER_ARRIVED_AT_HANDOVER →
  exception if product absent → HANDOVER_INSPECTION_COMPLETED → explicit ACCEPT or REJECT); NO 24/48/72h window, NO silence/time/job
  acceptance in code, triggers, or jobs (negative tests for all three); only human reminders/escalation allowed.
- **PB-22 — Disputes.** Acceptance: dispute freezes closure and settlement; resolution by human only; refund path REFUND_PENDING → REFUNDED
  only with institution settlement/refund reference; all dispute actions audited.

### EPIC E — Security, jobs, files (Sprint 3)
- **PB-23 — Auth + RBAC + separation of duties.** Acceptance: JWT + argon2id; backend 403 on permission violation (not UI-only);
  funding confirmer ≠ settlement approver for the SAME transaction (backend-enforced, tested).
- **PB-24 — Redis + BullMQ jobs.** Acceptance: async WhatsApp processing, safe retries, Webhook flow protection, reminders/escalations —
  and NO job makes a financial decision or an acceptance decision (negative tests).
- **PB-25 — Files + backup.** Acceptance: S3-compatible storage, short-lived signed links, sensitive data masked in display/logs,
  daily encrypted backup + periodic restore test with written restore record.

### EPIC F — Testing, deployment, handover (Sprint 4 + Sprint 5)
- **PB-26 — Critical tests (11).** Acceptance: all 11 tests in CORE PROMPT §15 pass TWICE consecutively, plus a negative test for every
  prohibition in §1.1. Test suite without negative tests is INCOMPLETE.
- **PB-27 — UAT + training.** Acceptance: UAT scenarios covering explicit-acceptance path and rejection/dispute path end-to-end;
  signed UAT minutes; staff training delivered.
- **PB-28 — Deployment + delivery package.** Acceptance: Docker Compose repeatable deployment; delivery outputs exactly as CORE PROMPT
  §14.2 (source, repo access, schema, migrations, config without secrets, docs, runbooks, access data, OSS list); no secret in any file;
  hosting/domain/external accounts in client's name wherever the provider allows.
- **PB-29 — Compliance report.** Acceptance: every v3.1 requirement mapped to implemented / tested / evidence (file + test name);
  anything unmapped = unfinished. Report delivered with Sprint 5.

## Explicitly OUT OF BACKLOG (never add without a signed written change request)
Control Tower (any form), marketplace/catalog, wallet/balance/ledger, payment gateway, bank API, multi-currency accounting,
multi-institution support, customer app/portal, marketing broadcasts, store sync, AI selling/closing/dispute decisions,
platform fees/commissions/distributions, production-scale architecture beyond the pilot.

## Sprint 0 plan (Week 1) — presented for approval, NO code yet
- **Sprint Goal:** "Old build safely archived, new build scaffolded from zero, and Sprint 1 scope frozen — with zero v3.1 violations."
- **Day 1–2:** Read governing sources + role skills (DONE this turn, with the v3.1-overrides note above). Present this Backlog + Sprint 0 plan to Ahmed.
- **Day 3 (after Ahmed's written approval ONLY):** Execute PB-01 archiving, verify archive, write ARCHIVE-NOTE.md. No GitHub action.
- **Day 4–5:** PB-02 + PB-03: new path, NestJS + React skeleton, Docker Compose, CI, `.env.example` (names only), secret grep clean.
- **Sprint 0 Definition of Done:** archive verified + skeleton runs from zero + CI green + zero secrets + zero Control Tower artefacts +
  checkpoint file `~/workspace/pilot-system-v31/docs/checkpoint.md` created + Sprint 0 Report + written acceptance requested.
- **Sprint 0 Exit Gate:** Ahmed accepts Sprint 0 IN WRITING. Only then does Sprint 1 start. A rejected Sprint 0 is reworked, never carried forward silently.
- **What Sprint 0 does NOT do:** no transaction logic, no state machine code, no WhatsApp sending, no database tables beyond the skeleton,
  no push to GitHub, no Render deploy. Those belong to Sprints 1–5.

## Roles applied this turn
- Systems Analyst (`software-systems-analysis`): scope, actors, state machine, data model — applied, with v3.1 overrides recorded above.
- Software Engineer (`software-engineering`): engineering loop, Definition of Done, quality gates — applied.
- Full Stack Developer (`system-architecture`, `database-and-api-design`, `professional-programming`): stack and module boundaries — applied in PB-02/04.
- WhatsApp API Specialist (`whatsapp-api-projects`): direct Cloud API, HMAC, idempotency, 24h window, templates — applied in PB-11/12/14.
- Note: `requirements-engineering` and `testing-and-qa` skill files will be read at Sprint 1 planning and Sprint 4 respectively, and recorded then.
