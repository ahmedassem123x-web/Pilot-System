# Sprint 4 Report — Completion + Testing (PB-13, PB-26, PB-27)

Date: 2026-11-02. Builder: Sprint 4 subagent (parent coordinator's
instruction). Scope: ONLY `~/workspace/pilot-system-v31/`. No contact
with the user, no GitHub push, no deploy, archive
`~/workspace/pilot-system-archive-v1/` untouched.

## Sprint goal (met)

Prove the system: the full WhatsApp inbox triptych, all 11 critical
tests twice, a negative test for every §1.1 prohibition, the full
suites twice, plus UAT and training material — with the Sprint 3
Guard bug fixed properly, not worked around.

## MANDATORY BUG FIX FIRST — REFUND_PENDING Guard (Sprint 3 finding, fixed here)

- Bug: `DISPUTE_RESOLVED_REFUND` in
  `backend/src/transactions/transactions.service.ts` rejected when
  ANY audit row had `new_state === 'SETTLED'` — including a
  `TRANSITION_REJECTED` audit from a correctly-rejected settlement
  attempt while DISPUTED. That poisoned a later legitimate
  DISPUTED → REFUND_PENDING transition.
- Fix (one Guard line + comment, no other Guard touched): a
  settlement now counts ONLY when the audit row is a successful
  settlement — `action === 'SETTLEMENT_RECORDED' &&
  new_state === 'SETTLED'`. A rejected attempt writes
  `TRANSITION_REJECTED`, never `SETTLEMENT_RECORDED`, so it can no
  longer poison the refund path. A genuinely executed settlement
  still blocks the refund path, as the matrix requires.
- Regression proof:
  `backend/src/transactions/guard-refund-after-rejected-settlement.spec.ts`
  (2 tests): on ONE transaction — settlement attempt while DISPUTED
  correctly rejected (TRANSITION_REJECTED audit with new_state
  SETTLED present) → human resolution to REFUND_PENDING succeeds →
  refund with institution reference succeeds → COMPLETED via the
  refund route. Plus a control test that a rejected attempt alone
  never creates a SETTLEMENT_RECORDED audit.
- No test was weakened to make this pass. The Sprint 3 tests that
  were split across separate transactions to avoid the bug still
  pass unchanged, and now also pass on a single transaction (see the
  regression spec).

## What was built (files created / changed)

### Backend — inbox read endpoints (PB-13, minimal, Guard-safe)

- `backend/src/inbox/inbox.service.ts` (new) — conversations DERIVED
  from MessageLog rows grouped by transaction_id (unlinked logs are
  their own conversations); staff triage metadata (assignment, tags,
  triage, internal notes) held in service memory. It NEVER writes a
  MessageLog, NEVER calls the transaction service, NEVER performs a
  transition, and NEVER treats a message as confirmation. Internal
  notes are metadata ONLY — they can never be sent.
- `backend/src/inbox/inbox.controller.ts` (new, staff JWT only) —
  GET `/api/whatsapp/messages` (filters: transactionId, direction,
  status), GET `/api/whatsapp/inbox` (filters: search, tag,
  assignedTo, triage), GET `/api/whatsapp/inbox/:id`, POST
  `.../assign`, `.../tags`, `.../triage`, `.../notes`.
- `backend/src/inbox/inbox.module.ts` (new) + `app.module.ts` wiring
  (import only). Two real wiring failures found and fixed, not
  hidden: InboxService needed `@Inject(InMemoryStore)` (the Store
  interface is not a Nest token) and InboxModule needed AuthModule
  (for JwtAuthGuard).
- `backend/src/http/inbox.http.spec.ts` (new, 6 tests) — auth
  required, message filters, conversation grouping + computed triage
  (FAILED → attention), assignment/tags/triage/notes as metadata
  only (MessageLog count unchanged after a note), 404 for unknown
  conversation, 422 for invalid triage.

### Backend — critical tests + prohibitions (PB-26)

- `backend/src/critical/critical.spec.ts` (new, 11 tests) — the 11
  CORE PROMPT §15 tests in one place: (1) wrong-signature webhook
  rejected, no MessageLog; (2) duplicate event, no duplicate effect;
  (3) unauthorised transition rejected (PERMISSION_DENIED + audit);
  (4) settlement without coordination record + external reference
  prevented (mismatched deposit reference rejected; direct SETTLED
  from RECEIPT_CONFIRMED forbidden); (5) funding confirmer ≠
  settlement approver (SEPARATION_OF_DUTIES_VIOLATION); (6) closure
  frozen on open dispute; (7) audit modification prevented
  (IMMUTABLE_ROW, incl. contract versions); (8) backup/restore
  round-trip (state, audit count, evidence status preserved);
  (9) explicit-acceptance path end to end; (10) rejection/dispute
  path end to end; (11) amendment after funding/shipping prevented
  AND acceptance by silence/time/job prevented (no accept recorded
  → Guard fails; forbidden job names refused by the closed list).
  Note on test 4's honesty: a RECEIPT_CONFIRMED transaction always
  has a confirmed coordination record (funding is a prerequisite),
  so the no-coordination half is proven by the funding-gate tests,
  and this test proves the reference half + the no-shortcut half.
- `backend/src/critical/prohibitions.spec.ts` (new, 11 tests) — one
  negative test per §1.1 prohibition family, reading real non-spec
  source + schema + migration with comments stripped (prohibition
  WORDS in comments are not artefacts): Control Tower absence;
  no timers/schedulers/cron/acceptance-window identifiers +
  immutability-only triggers; no wallet/ledger/gateway/disburse/
  payout; no fees/commissions/distributions; no marketplace/
  catalogue/customer portal; no unofficial transports/BSP; no AI
  selling/closing/deciding; no broadcasts/store sync; no
  multi-currency/multi-institution; no demo seeding/escrow claim;
  no literal secret assignment. Three pattern fixes during writing
  (recorded, not hidden): the 24h customer-service window constant
  is legitimate and is NOT an acceptance window; schema comments
  must be stripped like code comments; test-fixture constant names
  (TEST_JWT_SECRET) need a word-boundary lookbehind.

### Frontend — inbox triptych (PB-13)

- `frontend/src/Inbox.tsx` (new) — list | chat | details, full
  height, no cards inside the workspace. Search (conversation /
  transaction / message text), channel/tag/agent filters, triage
  chips (all/open/attention/resolved), assignment, tags, linked
  contract + state, date separators, bubbles with ticks
  (sending…/✓ sent/✓✓ delivered/✓✓ read/failed, dry-run labelled),
  template bubbles as buttons, media bubbles, reply/quote, internal
  notes as centred system notices (never sent), single composer.
  Desktop = all three panes; phone = list → chat → drawer with back
  buttons. Without a backend base URL the composer SENDS NOTHING
  and metadata changes are local-only, labelled as such.
- `frontend/src/Inbox.test.tsx` (new, 8 tests) — desktop three
  panes + linked contract/state; search + triage filtering; date
  separators, every tick, dry-run labels, template buttons, media
  bubbles; reply/quote + single composer; centred never-sent
  notes; assignment/tags local update; phone list → chat → drawer;
  composer without backend shows the not-connected notice.
- `frontend/src/App.tsx` (changed, additive) — new `Inbox` tab
  wiring the triptych to the panel's loaded transaction (messages
  mapped from the panel fixture shape; dates empty for panel-mapped
  messages, so no separators are drawn there — separators come
  from dated inbox data). No other tab changed.

### Docs (PB-27)

- `docs/uat-script.md` (new) — scenarios A (explicit-acceptance),
  B (rejection/dispute), C (funding-gate), D (settlement),
  E (exceptions), I (inbox triptych), each step with an expected
  result, plus a sign-off block that is UNSIGNED until Ahmed signs.
  No UAT session has been run; no signature is claimed.
- `docs/operator-runbook.md` (new) — training material: daily
  operations, verification path, settlement, refunds, disputes,
  Sold-as-Seen handover, inbox triptych, backup/restore, incident
  escalation, delivery handover.

## Tests — real outputs (this environment: Node 24.22.1, project pins Node 20)

- Backend full suite, run 1: **185/185, 24 suites** (155 Sprint 2+3
  unchanged + 30 new Sprint 4: 2 Guard regression + 6 inbox HTTP +
  11 critical + 11 prohibitions).
- Backend full suite, run 2 (consecutive): **185/185, 24 suites** again.
- Frontend, run 1: **15/15** (7 Sprint 3 + 8 inbox). Run 2:
  **15/15** again.
- Backend `npm run lint` (eslint --max-warnings 0) clean; backend
  `npm run build` (tsc) clean. Frontend `npm run lint` clean;
  frontend `npm run build` (tsc + vite, 162.86 kB JS) clean.
- Live boot check (compiled `dist/main.js`, port 3102, test-only
  env values): GET /health → 200 `{"ok":true}`; GET
  /api/whatsapp/inbox without token → 401; webhook GET with wrong
  verify token → 403; webhook GET with correct token → 200 with the
  challenge echoed. Server stopped afterwards (port verified free).
- Real failures found and fixed (not hidden): (1) two Nest DI
  wiring failures for the inbox module (see above); (2) Jest
  toThrow matches messages, not error codes — four critical tests
  now assert codes explicitly via a helper; (3) frontend tick
  assertions needed getAllByText for repeated ticks, and the tag
  assertion for a tag that also appears as a filter option; (4) an
  async local-update race in inbox metadata handlers — handlers now
  apply local-only changes synchronously when no backend is set.

## Backlog coverage

PB-13 inbox triptych ✓ (backend read endpoints + frontend triptych
+ HTTP + UI tests). PB-26 critical tests ✓ (11/11 twice +
prohibitions). PB-27 UAT + training ✓ as SCRIPT + RUNBOOK — UAT
minutes are NOT signed (that requires Ahmed) and no training session
has been delivered.

## Verified live vs mocked vs unverified (honest, three lists)

- VERIFIED LIVE (in this environment): HTTP routing + JWT + inbox
  reads + triage metadata over real HTTP, webhook HMAC + verify
  handshake over a live boot, full suites twice, lints + builds.
- MOCKED / TEST DOUBLE: every backend test runs against
  InMemoryStore (NOT Prisma/PostgreSQL); queue is in-memory/test
  transport (NOT Redis-backed); WhatsApp sends are dry-run rows
  (NOT real Meta sends); file storage is metadata only.
- UNVERIFIED: live PostgreSQL behaviour, live Redis, live Meta
  sends, live Postgres restore, Docker Compose up, GitHub Actions,
  Node 20 behaviour (local Node 24.22.1), UAT execution + signature,
  and — as a known gap — MessageLog carries no message-body or media
  columns, so the triptych renders text/media from its message props
  and the backend read endpoints return logs as stored; storing
  message bodies/media references is a follow-up data-model item,
  not claimed here.

## Grep results (Sprint 4 end)

- Control Tower artefacts in code + schema: **0** (prohibitions
  spec + shell grep; see Sprint 5 compliance report for the exact
  commands).
- Secrets in non-spec runtime source: **0** (env var NAMES only;
  test-only values only in specs + `src/testing/*`, labelled).

## What is NOT done (plainly)

- No UAT session run, no UAT minutes signed, no training delivered.
- No Prisma Store, no live Postgres, no live Redis, no real Meta
  transport, no real object storage, no Docker run, no GitHub push,
  no deploy. Those are Sprint 5 items, reported honestly there.
- Message-body/media storage in MessageLog: not in the Sprint 1
  schema; triptych display props cover it, backend storage does not.
