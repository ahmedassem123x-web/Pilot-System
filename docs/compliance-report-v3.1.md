# Compliance Report — Pilot System v3.1 (Sprint 5, PB-29)

Date: 2026-11-02. Governing source: CORE PROMPT (English) +
client alignment MVP-TECH-2026-002 v3.1 + ORTECH-MVP-RESP-2026-001
v1.0. Rule: anything unmapped = unfinished, listed honestly in §3.
Every test cited runs against the IN-MEMORY TEST DOUBLE unless a
row says otherwise — never read a test-double result as a live
Postgres/Meta/Redis result.

Status key: ✅ implemented + tested · ◐ implemented, test-double only
or partially · ❌ not implemented / unverified (see §3).

## 1. Scope principles (CORE PROMPT §1) and absolute prohibitions (§1.1)

| Requirement | Status | Evidence (file + test) |
| --- | --- | --- |
| §1.1 No marketplace, catalogue, matching | ✅ | No such code/route/table; `critical/prohibitions.spec.ts` "no marketplace…" |
| §1.2 Agreement outside system before creation | ✅ | Transactions document an existing agreement; no negotiation flow exists; backlog PB-06–07 |
| §1.3 No internal wallet/balance/account | ✅ | No such field/table; prohibitions spec "no wallet…" |
| §1.4 System NEVER executes deposit/transfer/settlement/refund | ✅ | Guards only RECORD external confirmation; prohibitions spec "no money movement" |
| §1.5 No automated bank/financial integration | ✅ | No bank API code; manual coordination only; `transactions.controller.ts` coordination routes |
| §1.6 Institution ALONE receives/holds/executes | ✅ | Model + runbooks; institution confirmation is the only funding/settlement input |
| §1.7 ONLY customer interface = WhatsApp Business Platform | ✅ | No customer app/portal; prohibitions spec route check; panel is staff-only |
| §1.8 ONE lightweight internal operations panel, staff only | ✅ | `frontend/src/App.tsx` (+ `Inbox.tsx` tab); JWT + RBAC on every route |
| §1.9 Every FI action MANUAL and DOCUMENTED | ✅ | Coordination records + audit; `operator-runbook.md` §2 |
| §1.10 No platform fees/commissions/deductions/distributions; amount DESCRIPTIVE only | ✅ | No fee code; amount labelled descriptive in panel; prohibitions spec "no fees…" |
| §1.1 Control Tower absent in UI, API, tables, roles, reports | ✅ | Grep 0 (see §4); prohibitions spec "no Control Tower…" |
| §1.1 No implicit acceptance (no window, silence, time, job) | ✅ | No timer/cron/job path; `transactions/no-implicit-acceptance.spec.ts`; critical test 11 |
| §1.1 No fake/demo data presented as real; no demo auto-seed | ✅ | No seed path; prohibitions spec "no demo seeding"; panel sends nothing without a backend |
| §1.1 No secrets in code/repo/chat/log/file | ✅ | Grep 0 in non-spec source (see §4); `.env.example` names only |
| §1.1 No WhatsApp Web/QR/Baileys/Evolution/WAHA transport | ✅ | Direct Cloud API design only; prohibitions spec; dry-run transport only |
| §1.1 No AI selling/closing/dispute-deciding/sending-unreviewed | ✅ | No AI code; human-only resolution; prohibitions spec "no AI…" |
| §1.1 No multi-currency accounting, multi-institution, production-scale excess | ✅ | Single recorded currency field, no conversion; no institution table; prohibitions spec |

## 2. Requirements map (by CORE PROMPT section)

### §6 Stack

| Requirement | Status | Evidence |
| --- | --- | --- |
| Node 20 + TS 5 + NestJS 10 backend | ◐ | Implemented; Dockerfiles + CI pin Node 20, but local runs use Node 24.22.1 — Node 20 behaviour UNVERIFIED |
| PostgreSQL 16 + Prisma 5 + SQL migrations | ◐ | Schema (582 lines) + migration (312 lines) written and cross-checked by hand; NOT tool-validated, NOT applied (see §3) |
| Redis 7 + BullMQ 5 | ❌ | Queue interface + closed job list implemented on an IN-MEMORY transport; live Redis/BullMQ UNVERIFIED, no Redis server here |
| React 18 + Vite operations UI | ✅ | `frontend/` builds clean; panel + triptych tested (15/15) |
| Direct Meta Cloud API, no BSP baseline | ◐ | Webhook + dry-run transport implemented; real transport swap documented, NOT executed (see §3) |
| S3-compatible object storage | ◐ | File METADATA + signed links only; no real bucket (see §3) |
| Docker + Docker Compose deployment | ◐ | Compose file + Dockerfiles written, YAML-parsed; `docker compose up` NOT run (no Docker here) |
| Tests: Vitest/Jest + Supertest (+ Playwright) | ◐ | Jest + Supertest + Vitest used; Playwright NOT used (no browser E2E suite) |
| 11 NestJS modules, no Control Tower module | ✅ | Auth, Users, Transactions, Contracts (in Transactions), WhatsApp, Templates, Evidence (in Transactions), SettlementCoordination (in Transactions), Disputes (in Transactions), Audit, Admin, Files, Backup, Queue, Inbox (read model); grep 0 for Control Tower |
| Redis/BullMQ purpose: async processing/retries/reminders ONLY, no financial/acceptance decision | ✅ | Closed job list + negative tests; critical test 11; `queue/queue.service.ts` |
| Environments separated; env files contain no secrets | ✅ | `.env.example` + development/production examples, names only |

### §7 Data model

| Requirement | Status | Evidence |
| --- | --- | --- |
| User: permanent UUID, unique whatsapp_number, APPROVED/NOT_APPROVED/SUSPENDED | ✅ | `store/repository.ts` + `users/users.identity.spec.ts` |
| TransactionParty: BUYER/SELLER per transaction ONLY; same person both roles across transactions = no second User | ✅ | `users.identity.spec.ts`; `transactions.service.ts` createTransactionWithParties |
| Transaction: 15-state field + descriptive amount + product/quantity/delivery/cancellation fields | ✅ | Schema + `transactions.service.ts` submit Guard |
| ContractVersion: SHA-256 hash, accepted_at/accepted_by, superseded_by; never deleted/overwritten | ✅ | `contracts.versions.spec.ts`; immutability triggers + IMMUTABLE_ROW |
| Current version = highest version_number; superseded_by ignored for currency, never back-filled (matrix §8a) | ✅ | Service + amendment spec; transition-matrix §8 |
| accepted_by = recording STAFF only; row 3 needs TWO party-acceptance audits + MessageLogs (matrix §8b) | ✅ | `CONTRACT_ACCEPTED` Guard; positive spec row 3 |
| PaymentEvidence: status ALWAYS `Payment Evidence Submitted` | ✅ | Single-value type; funding/evidence-separation spec |
| FinancialCoordinationRecord: ONLY place institution confirmation enters | ✅ | Coordination routes + funding Guard reads ONLY coordination records |
| 4 financial references as SEPARATE fields | ✅ | Detail + `/financial-references` endpoints; separate fields throughout |
| Deposit-reference UNIQUE across transactions; duplicate surfaces for manual review | ✅ | Store uniqueness + `COORDINATION_REJECTED_DUPLICATE_REFERENCE` audit; funding spec |
| DeliveryEvent incl. BUYER_ARRIVED_AT_HANDOVER, HANDOVER_INSPECTION_COMPLETED + seller/readiness/exception events | ✅ | `acceptance.handover.spec.ts`; handover panel section |
| Dispute: reason, evidence, status, resolution, resolver, timestamp; freezes closure/settlement | ✅ | `dispute.freezing.spec.ts`; HTTP dispute tests |
| SettlementSummary prepared MANUALLY, never auto-generated from WhatsApp alone | ✅ | Manual summary form + Guard; beneficiary-protection test |
| AuditEvent append-only, database-enforced (revoke UPDATE/DELETE or immutable table) | ◐ | Migration triggers + store IMMUTABLE_ROW + tests; role-level REVOKE is a deploy-machine step (checklist §3), NOT yet executed |
| MessageLog: whatsapp_message_id unique (idempotency), direction, template, status, timestamps | ✅ | Schema + webhook idempotency tests |
| RBAC: backend-enforced 403, never UI-only | ✅ | PermissionsGuard + service-layer checks; `auth.rbac.spec.ts`; HTTP 403 tests |

### §8 State machine (15 states, 26 allowed rows, 184 forbidden pairs in matrix counting)

| Requirement | Status | Evidence |
| --- | --- | --- |
| Exactly 15 states, no more | ✅ | `common/transaction-state.ts`; schema enum; positive/negative specs |
| Every allowed transition works + writes exactly one audit entry | ✅ | `state-machine.positive.spec.ts` (all 26 rows; row 22 once per eligible target) |
| Every forbidden transition rejected with error code + audit entry | ✅ | `state-machine.negative.spec.ts` (full ordered-pair sweep; 179 unconditionally + 5 conditionally forbidden returns — see checkpoint reconciliation note) |
| Self-transitions rejected | ✅ | SELF_TRANSITION + audit; negative spec |
| DISPUTED entered from open states; financial steps + closure BLOCKED while DISPUTED | ✅ | `dispute.freezing.spec.ts`; critical test 6 |
| REFUND_PENDING → REFUNDED only with institution settlement/refund reference | ✅ | Row 25 Guard; dispute + critical test 10 |
| CANCELLED terminal, never deletion | ✅ | No outgoing rows; terminal-state negative tests |
| SETTLED → COMPLETED and REFUNDED → COMPLETED only; no shortcut to COMPLETED | ✅ | `completion.spec.ts`; critical tests 9/10 |
| Handover events are NOT states | ✅ | DeliveryEvent types only; no 16th state anywhere |

### §9 Sold as Seen

| Requirement | Status | Evidence |
| --- | --- | --- |
| Exact 6-step sequence, no skipping | ✅ | `acceptance.handover.spec.ts`; panel Handover section; UAT scenario A/E |
| Product-absent exception: state stays DELIVERED, no accept/reject until resolved + real handover | ✅ | Handover spec + HTTP tests |
| No 24/48/72h window; silence ≠ acceptance; time ≠ acceptance | ✅ | No such code (prohibitions + no-implicit-acceptance specs); critical test 11 |
| No scheduled job accepts/settles/closes; human reminders/escalation only | ✅ | Closed job list (reminder.send, escalation.notify only); critical test 11 |

### §10 Amendment policy

| Requirement | Status | Evidence |
| --- | --- | --- |
| Before acceptance: new version, old preserved | ✅ | `amendment.spec.ts` |
| After acceptance, before funding/shipping: BOTH approvals + new version + re-acceptance | ✅ | Row 5 Guard + amendment spec |
| After confirmed funding/shipping: FORBIDDEN; path = dispute or later documented agreement | ✅ | AMENDMENT_FORBIDDEN + audit; amendment spec; critical test 11 |

### §11 Financial mechanism

| Requirement | Status | Evidence |
| --- | --- | --- |
| §11.1 Configurable voucher fields, no fixed beneficiary/account before institution approval | ✅ | `VOUCHER_FIELDS` + voucher endpoint; panel voucher read-back |
| §11.2 Buyer evidence strictly separated from institution confirmation | ✅ | Data model, UI wording, HTTP tests; funding/evidence-separation spec |
| §11.3 Manual verification path in order (review → contact → send accepted info → request → record) | ✅ | Coordination endpoints + panel Verification tab + operator runbook §2 |
| §11.4 Funding gate: institution confirmation AND deposit reference, both required | ✅ | Row 8 Guard; funding spec; UAT scenario C |
| §11.5 Settlement + beneficiary protection (no WhatsApp-only change; discrepancy = follow-up) | ✅ | Row 17 Guard + beneficiary test; settlement spec |
| §11.5 Settlement/refund recorded as EXECUTED only after institution confirmation, with all fields | ✅ | Rows 19/25 Guards + confirmation recording |
| §11.6 Build-now vs defer line respected | ✅ | Record lifecycle/evidence/audit built; channels/accounts/beneficiaries/matching criteria NOT fixed (deferred to written FI agreement) |

### §12 WhatsApp

| Requirement | Status | Evidence |
| --- | --- | --- |
| Direct Meta Cloud API; ownership client-owned; staff permissions returned at delivery | ◐ | Design + swap doc implemented; migration/handover are deploy-time procedures (checklist §4–§5), NOT executed |
| Webhook HMAC SHA-256, constant-time compare | ✅ | `whatsapp.service.ts`; HTTP + critical test 1; live boot check (403 on wrong token) |
| Idempotency by whatsapp_message_id, no duplicate effect | ✅ | Critical test 2; HTTP webhook tests |
| Statuses never downgrade except to FAILED | ✅ | Monotonicity in `whatsapp.service.ts`; HTTP tests |
| 24h window: free text inside, approved Utility templates outside | ✅ | `templates.service.ts` window gate; HTTP tests |
| Local vs Meta approval shown SEPARATELY; Meta-rejected = un-sendable + reason shown | ✅ | Template service + panel tables + triptych; HTTP tests |
| Dry-run never claimed as sent; labelled everywhere; excluded from sent counts | ✅ | DryRunTransport + `countActuallySent`; panel + triptych labels |
| Buttons ≤3, lists ≤10, trigger on id never title | ✅ | TemplatesService caps; webhook interactive-id tests |
| No send triggered by a transition alone without window/template/human-review gates | ✅ | Send path is staff-initiated via templates service; no transition calls send |

### §13 Operations panel (ONE, lightweight, staff only)

| Requirement | Status | Evidence |
| --- | --- | --- |
| Panel DOES (all 10 functions in §13.1) | ✅ | `App.tsx` tabs Lifecycle/Evidence/Verification/Institution/Settlement/Disputes/Handover/Inbox/Messages/Audit/Users |
| Panel NEVER DOES (§13.2 prohibitions) | ✅ | No such buttons/routes; forbidden-endpoints spec; panel forbidden-action UI test |
| PB-13 triptych: list \| chat \| details, full height, no cards in workspace; search/filters/triage/assignment/tags/linked contract+state/date separators/ticks/template buttons/media/reply-quote/notes/composer; phone list→chat→drawer | ✅ | `Inbox.tsx` + `Inbox.test.tsx` (8 tests) + backend inbox endpoints + HTTP tests |
| Known triptych gap: MessageLog has no body/media columns | ◐ | Triptych renders text/media from message props; backend stores logs as defined by the Sprint 1 schema. Body/media storage is a follow-up data-model item (see §3). |

### §14 Security, ownership, delivery

| Requirement | Status | Evidence |
| --- | --- | --- |
| HMAC webhook verification | ✅ | See §12 |
| Admin sessions + JWT; passwords hashed argon2id | ✅ | `auth.service.ts` (real `$argon2id$` output verified in Sprint 2); login endpoint |
| RBAC + separation of duties, backend-enforced + tested | ✅ | Critical test 5; SoD spec; HTTP SoD test |
| Append-only audit, database-level | ◐ | Triggers + IMMUTABLE_ROW; role REVOKE is a deploy step (see §3) |
| Encryption in transit/at rest; short-lived signed file links | ◐ | Signed links (HMAC + expiry + tamper tests) implemented; TLS/storage encryption is a deploy-machine property, NOT verified here |
| Daily encrypted backup + periodic restore test with written record | ◐ | Procedure + snapshot round-trip tested; LIVE Postgres restore NOT done (see §3) |
| Sensitive data masked in display/logs | ✅ | `common/masking.ts`; masked display in files/messages (audit details unmasked by design — staff-only, JWT + `audit.view`) |
| Delivery outputs (§14.2) | ◐ | All present in this tree EXCEPT repo access (owner action) and client-name hosting/accounts (deploy-machine actions); see deployment-checklist §7 |
| Costs outside development price stated | ✅ | CORE PROMPT §14.3 carried into runbooks; no fee is charged by the system |

### §15 Critical tests (each TWICE)

| Test | Status | Evidence |
| --- | --- | --- |
| 1 Wrong-signature webhook rejected | ✅ twice | `critical.spec.ts` test 1; full suite ran twice (185/185, 185/185) |
| 2 Duplicate event, no duplicate effect | ✅ twice | `critical.spec.ts` test 2; full suite twice |
| 3 Unauthorised transition rejected | ✅ twice | `critical.spec.ts` test 3; full suite twice |
| 4 Settlement without coordination + external reference prevented | ✅ twice | `critical.spec.ts` test 4 (+ funding-gate tests); full suite twice |
| 5 Funding confirmer ≠ settlement approver | ✅ twice | `critical.spec.ts` test 5; full suite twice |
| 6 Closure frozen on open dispute | ✅ twice | `critical.spec.ts` test 6; full suite twice |
| 7 Audit modification prevented | ✅ twice | `critical.spec.ts` test 7; full suite twice |
| 8 Backup/restore | ◐ twice (test-double only) | `critical.spec.ts` test 8 + backup restore spec; LIVE Postgres restore NOT done |
| 9 Explicit-acceptance path | ✅ twice | `critical.spec.ts` test 9; full suite twice |
| 10 Rejection/dispute path | ✅ twice | `critical.spec.ts` test 10; full suite twice |
| 11 Amendment after funding/shipping prevented AND acceptance by silence/time/job prevented | ✅ twice | `critical.spec.ts` test 11; full suite twice |
| Negative test for EVERY §1.1 prohibition | ✅ | `prohibitions.spec.ts` (11 tests); full suite twice |

### §19 Pending decisions (NOT defects)

FI approval in writing, payment channels, account/beneficiary/reference data per channel, institution-required verification/settlement/refund fields, pilot fee policy, final Meta account/number — ALL STILL PENDING. No real financial operation may start before item 1. This report does not present any of them as decided.

## 3. Unfinished / unverified — the honest list (anything here = not done)

1. **Live Postgres apply** — migration never applied to any Postgres; no `psql`/Docker here. Schema NOT tool-validated (`prisma validate`/`generate` exit 1 in this environment).
2. **Prisma Store implementation** — the backend still runs on the InMemoryStore test double. A Prisma Store (incl. inbox MessageLog listing, Decimal mapping, date revival) must be implemented and the full suite re-run against Postgres before any production use.
3. **Live Redis / BullMQ** — queue is the in-memory/test transport; live behaviour unverified.
4. **Live Meta sends** — dry-run only; real-transport swap not executed; no Meta account/token here.
5. **Live Postgres restore** — snapshot round-trip is unit-tested only; no real restore record exists.
6. **Docker run** — compose file reviewed + YAML-parsed; `docker compose config`/`up` never run (no Docker binary).
7. **GitHub Actions run** — CI workflow exists (Node 20: lint → test → build) but has never run; branch protection must be enabled by the repo owner.
8. **Node 20 behaviour** — all local runs use Node 24.22.1; Dockerfiles/CI pin Node 20.
9. **Triptych data gap** — MessageLog has no message-body or media columns (Sprint 1 schema); triptych text/media render from message props, backend returns stored logs only.
10. **Playwright E2E** — the stack lists Playwright; no browser E2E suite was written (Jest + Supertest + Vitest cover backend HTTP + frontend rendering).
11. **UAT execution + signature, staff training delivery** — script + runbook delivered; no session run, no minutes signed, no training delivered.
12. **GitHub push / Render deploy** — NOT done and NOT authorised by this task; requires Ahmed's separate explicit written authorisation.
13. **Role-level audit/contract REVOKE** — migration triggers exist; the deploy-machine REVOKE + verification (checklist §3 step 4) is not executed.
14. **TLS / at-rest encryption verification** — deploy-machine properties, not verified here.
15. **Final Meta account migration + permission handover** — deploy-time procedure, not executed.

## 4. Verification commands (Sprint 5 end, re-runnable)

- Control Tower artefacts in code + schema: `grep -rni "control.tower" backend/src --include="*.ts" --exclude="*.spec.ts" backend/prisma frontend/src` → **0 hits** (docs mention the prohibition only).
- Secrets in non-spec runtime source: `grep -rniE "(JWT_SECRET|WHATSAPP_APP_SECRET|FILE_LINK_SECRET)[[:space:]]*=[[:space:]]*['\"][^'\"]+['\"]" backend/src frontend/src --include="*.ts" --include="*.tsx" --exclude="*.spec.ts" --exclude="*.test.tsx"` → **1 hit, and it is the labelled test-only fixture** `TEST_JWT_SECRET` in `backend/src/testing/http.ts` (test support, never runtime source, never a real credential). Excluding specs + `src/testing/*`, the result is **0 hits**: runtime source references env var NAMES only.
- Full suites: backend `npm test` → 185/185 (24 suites) TWICE; frontend `npm test` → 15/15 TWICE; both lints clean (`--max-warnings 0`); both builds clean.
- Live boot check: /health 200, inbox 401 without token, webhook 403 wrong token / 200 + challenge correct token (port 3102, test-only env values, server stopped).
- Prisma: `npx prisma@5 validate` → exit 1, no validation output; `npx prisma@5 generate` → exit 1, same. Recorded honestly; no Prisma dependency added.
- Tools absent: `which psql pg_dump docker podman redis-server redis-cli` → all absent.

## 5. Sprint acceptance status

- Sprint 4 (PB-13, PB-26, PB-27): code + tests + UAT script + runbook delivered; acceptance requires Ahmed's WRITTEN acceptance (not given in this task).
- Sprint 5 (PB-28, PB-29): delivery package + this report delivered, with §3 as the explicit unfinished list; acceptance requires Ahmed's WRITTEN acceptance (not given in this task).
- No push, no deploy, no signature, and no completion claim beyond what §1–§2 evidence supports.
