# Sprint 3 Report — Operations Panel & Coordination (PB-11 to PB-25)

Date: 2026-11-02. Builder: Sprint 3 subagent (parent coordinator's
instruction). Scope: ONLY `~/workspace/pilot-system-v31/`. No contact
with the user, no GitHub push, no deploy, archive
`~/workspace/pilot-system-archive-v1/` untouched.

## Sprint goal (met)

A staff member can complete a full transaction cycle from the ONE
operations panel and its HTTP API WITHOUT touching money: lifecycle,
evidence, manual verification, institution confirmation, settlement
summary, dispute follow-up, handover recording, audit view, and user
administration — with every Guard still enforced in the Sprint 2
services underneath.

## What was built (files created / changed)

### Backend — new modules (all under `backend/src/`)

- `common/http-errors.ts` (new) — maps Sprint 2 DomainErrors to HTTP
  responses using the error's own code + status. No new error codes
  invented.
- `common/masking.ts` (new) — sensitive-data masking for display and
  logging surfaces (file metadata, message lists). Audit details are
  NOT masked: staff need full references to verify against the
  institution; audit access is staff-only (JWT + `audit.view`).
- `queue/queue.service.ts`, `queue/queue.module.ts` (new, PB-24) —
  CLOSED job list, enforced at enqueue: `whatsapp.inbound.process`,
  `reminder.send`, `escalation.notify`. Anything else throws. No
  timer, no scheduler, no background runner: retries happen only on
  an explicit `processPending` call, max 3 attempts, then failed.
  TRANSPORT: IN-MEMORY / TEST ONLY. Live Redis behaviour is
  UNVERIFIED (no Redis server here). The production transport is the
  Redis-backed queue from the v3.1 stack, swapped in Sprint 5 behind
  the same enqueue/process shape.
- `whatsapp/whatsapp.service.ts` (new, PB-11) — webhook: HMAC SHA-256
  over RAW body bytes, constant-time compare, header
  `x-hub-signature-256`; missing/mismatched signature or missing
  secret => 403 + `WEBHOOK_SIGNATURE_REJECTED` audit + NO MessageLog
  row; idempotency by `whatsapp_message_id` (duplicate =>
  `already-processed`, no duplicate effect); status monotonicity
  (QUEUED → SENT → DELIVERED → READ, FAILED from any state,
  downgrade ignored); interactive replies trigger on reply ID, never
  on title (title-only => ignored audit note, no action). NEVER
  imports the transaction service, NEVER calls a transition, NEVER
  treats a message as institution confirmation (proven by
  `http/forbidden-endpoints.spec.ts`).
- `whatsapp/templates.service.ts` (new, PB-12) — template catalogue
  with local and Meta approval stored and shown SEPARATELY;
  locally-approved but Meta-rejected => UN-SENDABLE with the
  rejection reason surfaced, never bypassed; customer-service window
  enforcement (free text inside, approved Utility templates only
  outside; no prior inbound message => outside); buttons ≤ 3, lists
  ≤ 10; `DryRunTransport` by default (see swap doc); sent-message
  counts EXCLUDE dry-run rows.
- `whatsapp/whatsapp.controller.ts`, `whatsapp/whatsapp.module.ts`
  (new) — GET verification handshake (challenge only on token
  match), POST webhook (HTTP 200 acknowledgement on verified
  events), staff-only template/message/queue-drain routes. Webhook
  routes carry NO JWT guard (Meta calls them); their authentication
  is the HMAC signature.
- `files/files.service.ts`, `files/files.controller.ts`,
  `files/files.module.ts` (new, PB-25) — file METADATA only (no
  bytes, no real bucket claim — local/test implementation behind an
  `ObjectStore` interface for the Sprint 5 S3-compatible swap);
  short-lived HMAC-signed links (`FILE_LINK_SECRET` env name only)
  with expiry + tamper rejection; masked uploader in display.
- `backup/backup.service.ts`, `backup/backup.module.ts` (new,
  PB-25) — snapshot export, validation (15-state check, evidence
  status must be `PAYMENT_EVIDENCE_SUBMITTED`, audit rows must carry
  action + correlation id), fresh-store-only import. See
  `docs/backup-restore-runbook.md`.
- `auth/auth.controller.ts` (new, PB-23) — POST `/api/auth/login`
  (argon2id verify, JWT), GET `/api/auth/me`. No password hash ever
  returned.
- `admin/admin.controller.ts`, `admin/admin.module.ts` (new, PB-23,
  PB-25) — staff/role/permission administration + backup
  export/import, all behind JWT + `admin.manage` (backend 403).
  `admin.manage` is a Sprint 3 administration permission only; it
  grants no transaction power by itself.
- `users/users.controller.ts` (new, PB-15) — create person, approve
  (`users.approve`), suspend (`users.suspend`).
- `audit/audit.controller.ts` (new, PB-15) — READ-ONLY audit view
  (`audit.view`). No update/delete route exists anywhere.
- `transactions/transactions.controller.ts` (new, PB-15 to PB-22) —
  create, detail (parties, versions, evidence, coordination,
  delivery events, disputes, summaries, messages, audit),
  transition (permission resolved DYNAMICALLY from the transition
  table inside the Sprint 2 service Guard — no second permission
  table to drift), party/handover acceptance recording, delivery
  events, operational-exception resolution, evidence submission,
  coordination recording, settlement confirmation, dispute
  resolution, amendment routing, audit view, the FOUR financial
  references as FOUR SEPARATE fields, and the configurable voucher
  (field list per CORE PROMPT §11.1 + issued voucher read back from
  its audit row; no beneficiary/account fixed before institution
  approval).

### Backend — changed (Sprint 2 files, additive only)

- `store/repository.ts` — ADDED: template approval fields on
  `CreateMessageLogInput`, `updateMessageLog()` (status/template
  updates; monotonicity stays in the WhatsApp service),
  `StoreSnapshot` + `exportSnapshot()` / `importSnapshot()`
  (fresh-store-only). NO Guard, NO transition row, NO existing
  method signature changed.
- `store/in-memory.store.ts` — implements the additions above.
  Still labelled the test double; still NOT Prisma/PostgreSQL.
- `app.module.ts` — imports the new modules. `main.ts` — enables
  Nest `rawBody` (required for webhook HMAC over raw bytes) and
  updates the boot log line. `auth.module.ts`, `users.module.ts`,
  `audit.module.ts`, `transactions.module.ts` — register their new
  controllers (wiring only).
- NOT TOUCHED: `transactions/transactions.service.ts`,
  `transactions/transition-table.ts` (Guard logic and the 26 rows are
  byte-identical to the Sprint 2 handover), `common/errors.ts`,
  `common/transaction-state.ts`, `auth/auth.service.ts`,
  `auth/rbac.service.ts`, `auth/jwt-auth.guard.ts`,
  `auth/permissions.guard.ts`, `prisma/schema.prisma`, and every
  Sprint 2 spec file.

### Frontend — operations panel (PB-15, PB-21)

- `frontend/src/App.tsx` (replaced skeleton) — ONE staff-only panel
  with tabs: Lifecycle (15-state timeline, current state marked),
  Evidence (contract versions + payment evidence, with the
  evidence-never-funding wording), Verification (manual path form),
  Institution (deposit reference + confirmation checkbox; the record
  button stays disabled until BOTH are present), Settlement (manual
  summary form + outcome-after-external-confirmation form, disabled
  until reference + date + document are present), Disputes
  (human-only resolution form), Handover (exact Sold-as-Seen 6-step
  sequence incl. the product-absent exception: state stays
  DELIVERED, no accept/reject until resolved + real handover),
  Messages (templates with SEPARATE local/Meta columns + sendable
  flag + rejection reason; messages with dry-run labels),
  Audit (append-only note, no edit/delete action), Users
  (approve/suspend). Without `apiBaseUrl` the panel SENDS NOTHING:
  submissions show a "backend not connected" notice instead of
  faking success. Amounts are labelled descriptive only.
- `frontend/src/App.test.tsx` (replaced skeleton test — the skeleton
  assertions are obsolete by design, not weakened: the new suite
  asserts sections, handover order, template separation, dry-run
  labelling, disabled-until-confirmed buttons, and forbidden-action
  absence on every tab).

### Docs

- `docs/sprint-3-report.md` (this file).
- `docs/backup-restore-runbook.md` (PB-25 procedure + restore test).
- `docs/whatsapp-real-transport-swap.md` (PB-12/14 swap point).
- `docs/checkpoint.md` — Sprint 3 section appended.
- `README.md` — Sprint 3 status note added at the top (the rest of
  the file is still Sprint 0-era and says so).

## Backlog coverage

PB-11 webhook/HMAC/idempotency ✓ (HTTP-tested, incl. raw-body HMAC).
PB-12 templates/window/dry-run ✓ (HTTP-tested, incl. Meta-rejected
gating and button/list caps). PB-13 inbox triptych + composer:
PARTIAL — the panel has a Messages section (templates table,
message list, dry-run labels) but NOT the full list | chat | details
triptych with search/filters/triage/assignment/tags/notes/composer
from the backlog; that triptych was specified for the customer inbox
and is carried as an open item for Sprint 4 (see "NOT done").
PB-14 test path + linking migration: the webhook verification +
dry-run path is implemented and tested; the migration to the final
client-owned Meta account/WABA/number is a Sprint 5 operational
procedure, NOT done here. PB-15 panel ✓. PB-16 voucher ✓. PB-17
evidence ≠ confirmation ✓ (data model, UI wording, HTTP tests).
PB-18 manual verification path ✓. PB-19 four references ✓ (separate
fields + uniqueness via Sprint 2 store + HTTP tests). PB-20
settlement + beneficiary protection ✓ (HTTP-tested, incl. the
WhatsApp-beneficiary rejection). PB-21 Sold-as-Seen ✓ (HTTP-tested
incl. product-absent exception). PB-22 disputes ✓ (HTTP-tested
freezing + human-only resolution + refund reference gate). PB-23
auth/RBAC/SoD ✓ (HTTP-tested incl. SoD via HTTP). PB-24 queue ✓
(in-memory/test transport; live Redis UNVERIFIED). PB-25 files +
backup ✓ (metadata + signed links; snapshot round-trip unit-tested;
live Postgres restore UNVERIFIED).

## Tests — real outputs (this environment: Node 24.22.1, project pins Node 20)

- Baseline before Sprint 3 work: backend 126/126 (14 suites).
- Sprint 3 backend, full suite: **155/155, 20 suites** — 126 Sprint 2
  tests still passing (no test weakened, none changed) + 29 new
  Sprint 3 tests (26 HTTP + 3 backup round-trip). Command:
  `cd backend && npm test` (jest --ci).
- Sprint 3 backend, second consecutive run: 155/155 again (run to
  satisfy the two-consecutive-runs rule; see verification log in the
  final handoff — both runs are recorded there).
- Frontend: **7/7 Vitest smoke tests**, `npm run build` clean
  (tsc --noEmit + vite build, 153.99 kB JS), `npm run lint` clean.
- Backend `npm run lint` (eslint --max-warnings 0) clean; backend
  `npm run build` (tsc) clean.
- Live boot check (compiled `dist/main.js`, port 3101, test-only
  env values): GET /health → 200 `{"ok":true}`; GET
  /api/transactions/x without token → 401; webhook GET with wrong
  verify token → 403; webhook GET with correct token → 200 with the
  challenge echoed. Server stopped afterwards.
- Real failures found and fixed (not hidden): (1) Nest POST
  defaults to 201, so the webhook handler now sets HTTP 200
  explicitly (Meta acknowledgement semantics). (2) Two dispute-test
  failures traced to a Sprint 2 Guard interaction (see below), fixed
  by restructuring the TESTS, not the Guard. (3) Frontend role
  queries collided across tests because this Vitest setup does not
  auto-clean the DOM — fixed with explicit `cleanup()` in the test
  file. (4) Two assertion-shape fixes in frontend tests (regex
  text matching, getAllByText for repeated dry-run labels).

## Finding for Sprint 4 (Guard logic NOT changed, per the handover contract)

Sprint 2's REFUND_PENDING Guard (`DISPUTE_RESOLVED_REFUND`) rejects
when ANY audit row has `new_state === 'SETTLED'` — including a
`TRANSITION_REJECTED` audit from a REJECTED settlement attempt while
DISPUTED. Evidence: in the first Sprint 3 dispute test, attempting
SETTLED while DISPUTED (correctly rejected with
FORBIDDEN_TRANSITION) wrote a TRANSITION_REJECTED audit with
new_state SETTLED, and the later legitimate DISPUTED → REFUND_PENDING
transition then failed its Guard. The Sprint 3 tests were split so
the freezing test and the refund-path test use separate transactions
(both pass). Whether the Guard should count only successful
settlement audits is a Sprint 4 decision for the parent coordinator
+ Ahmed — it requires a Guard change, which Sprint 3 was forbidden
to make, so it is reported here, not fixed here.

## Verified live vs mocked vs unverified (honest, three lists)

- VERIFIED LIVE (in this environment, by tests + boot check): HTTP
  routing + JWT auth + permission Guards (401/403), the full
  lifecycle over HTTP through the Sprint 2 Guards, webhook HMAC over
  raw bytes (correct/wrong/missing signatures over real HTTP),
  idempotency, status monotonicity, template gating, window
  enforcement, queue closed-list + retry cap, signed-link
  verify/tamper/expiry, snapshot export/validate/restore round-trip
  (test double), frontend panel rendering + build + lint.
- MOCKED / TEST DOUBLE (labelled as such in code and here): every
  backend test runs against `InMemoryStore` (NOT Prisma, NOT
  PostgreSQL); the queue is the in-memory/test transport (NOT
  Redis-backed); WhatsApp sends are dry-run rows (NOT real Meta
  sends); file storage is metadata only (NOT a real bucket).
- UNVERIFIED (must not be claimed): live PostgreSQL behaviour
  (Prisma validate/generate FAILED here — see below), live Redis
  queue behaviour, live Meta Cloud API sends, live restore against
  PostgreSQL, Docker Compose up, GitHub Actions, Node 20 behaviour
  (local Node is 24.22.1), and the PB-13 full inbox triptych.

## Prisma attempt — real result (recorded, not claimed)

- `npx prisma@5 validate` → exit 1 (only an npm "package was not
  found and will be installed" warning on stdout; no validation
  output).
- `npx prisma@5 generate` → exit 1, same.
- Direct `npm install prisma@5 --no-save` in a scratch dir → exit 1
  with `ECONNRESET` during tarball download (registry metadata
  reads work — `npm view prisma@5 version` lists versions — but the
  tarball fetch resets; same failure mode as Sprint 1/2).
- Consequence: the Sprint 1 schema was NOT tool-validated in this
  environment, no Prisma client was generated, and NO Prisma Store
  implementation was added (adding an untested Prisma dependency
  would have broken `npm ci` reproducibility). The Store interface
  extensions in this sprint keep the Prisma replacement shape (see
  service-interface.md checklist): a Sprint 5 Prisma Store must
  implement `updateMessageLog`, `exportSnapshot`,
  `importSnapshot`, and the template approval fields, with Decimal
  mapping for amounts and date revival for snapshot rows (the test
  double revives snapshot dates as ISO strings — a known test-double
  limitation, not a production semantic).
- Environment absence, verified: `which docker psql redis-server
  redis-cli` → all absent. No Meta account/token here (no live
  Meta test run, no token value anywhere).

## Grep results

- Control Tower artefacts in code + schema: **0** (`grep -rni
  "control.tower" backend/src --include="*.ts" --exclude="*.spec.ts"
  backend/prisma` → 0 hits; `frontend/src` → 0 hits). The phrase
  appears in this sprint's docs only as a prohibition, never as a
  module, table, role, permission, route, or report.
- Secrets in non-spec backend source: **0**. Test-only fixture
  values exist ONLY in `backend/src/testing/*` support code and in
  spec files, clearly labelled `test-only-*` (same convention as
  Sprint 2's `builders.ts`); runtime source references only
  environment VARIABLE NAMES: `JWT_SECRET`, `WHATSAPP_APP_SECRET`,
  `WHATSAPP_WEBHOOK_VERIFY_TOKEN` / `WHATSAPP_VERIFY_TOKEN`,
  `FILE_LINK_SECRET`, `PORT`, `DATABASE_URL` (schema, pre-existing).
- Forbidden-endpoint proof: `http/forbidden-endpoints.spec.ts`
  asserts 404 for 11 plausible forbidden paths with a full-permission
  token, asserts no forbidden route slug in any controller source,
  and asserts the webhook/queue/template modules never import the
  transaction service or call a transition.
- No-implicit-acceptance: Sprint 2's grep spec still passes — the new
  Sprint 3 source contains no timer, scheduler, queue-library, or
  hour-window code path (the queue module is deliberately named and
  written without those constructs; job kinds are a closed list).

## What is NOT done (plainly)

- PB-13 full inbox triptych (list | chat | details, search,
  filters, triage, assignment, tags, linked contract, reply/quote,
  internal notes, single composer, phone list → chat → drawer).
  The panel has a Messages section; the triptych is open for
  Sprint 4.
- Prisma Store implementation + migration apply to live PostgreSQL
  (blocked on registry/network here; see Prisma section).
- Redis-backed queue (live Redis behaviour UNVERIFIED).
- Real Meta transport (dry-run only; swap documented separately).
- Real object storage (metadata only; S3-compatible swap in
  Sprint 5).
- Live PostgreSQL restore test (snapshot round-trip is unit-tested
  on the test double only).
- No GitHub push, no deploy, no Sprint 4/5 work claimed.
- No secrets, no demo data auto-seeded, no Control Tower in any
  form, no money movement, no fees/commissions, no wallet/ledger/
  gateway/bank API, no multi-currency accounting, no
  multi-institution support, no customer portal, no broadcasts, no
  store sync, no AI selling/closing/dispute decisions, no implicit
  acceptance anywhere (code, triggers, jobs).
