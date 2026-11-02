# WhatsApp Test Path — Design / Skeleton ONLY (Sprint 1)

Status: DESIGN AND SKETCH ONLY. No runtime business logic is implemented
by this document, no message is sent by it, and no Sprint 2/3 code may be
treated as done because this sketch exists.

Governing sources: CORE PROMPT §12 (direct Meta Cloud API, HMAC,
idempotency, 24-hour window, templates, dry-run), §7 (MessageLog),
§11 (evidence ≠ confirmation — a WhatsApp message is never institution
confirmation). Data model: `backend/prisma/schema.prisma` (MessageLog).

Hard boundaries for this entire document (and for Sprints 0–1):

- NO real Meta token, NO real phone number, NO real WABA/account id, NO
  real recipient appears anywhere in this design. Configuration uses
  environment VARIABLE NAMES ONLY (see §6). Any value found in a file,
  log or chat is a defect to be deleted, not a detail to be kept.
- NO real WhatsApp message is sent from this work. Test traffic uses
  test accounts / test numbers only, and dry-run rows are labelled
  dry-run everywhere they are displayed.
- NO third-party messaging intermediary (BSP) is part of the baseline.
  The baseline is direct Meta WhatsApp Business Platform Cloud API only.
  An intermediary may be considered ONLY on an insurmountable obstacle
  with direct linking AND with written approval — that decision is NOT
  made here.
- NO WhatsApp Web / QR / unofficial transport. Only the Cloud API
  webhook + send endpoints described in §1–§2.
- The client owns the final Meta account, WABA and number wherever Meta
  permits. Development/testing starts on test accounts/numbers; linking
  is MIGRATED to the final account/number only after they are ready, and
  administrative permissions / product access data are RETURNED/HANDED
  OVER to the client at delivery. That migration is a Sprint 2/3
  operational procedure, not a Sprint 1 action.
- Until a written agreement with the financial institution exists, NO
  real financial operation starts. Test-path messages must never imply
  funding, settlement or acceptance.

## 1. Webhook contract — SKETCH (not runtime business logic)

The sketch below defines the contract Sprint 2 must implement and test.
It is a specification of request shape, verification order and storage —
it contains no executable handler, no SDK call and no send call. If a
reader can "run" this section, it has been misread: the runnable code
belongs to Sprint 2 (PB-11) and must be reviewed against this sketch.

### 1.1 Endpoint (path only — no host, no token, no number)

- Method + path (relative, to be mounted under the backend base path in
  Sprint 2 configuration): `POST /api/whatsapp/webhook`
- Verification handshake (Meta subscription verification, Sprint 2):
  `GET /api/whatsapp/webhook` with Meta's verification query parameters,
  answered ONLY when the supplied verification token matches the
  configured environment variable value. The variable NAME is
  `WHATSAPP_WEBHOOK_VERIFY_TOKEN`; the value is never written here.
- Content: JSON body as delivered by Meta. The handler must read the
  RAW body bytes for signature verification (§1.2) BEFORE any JSON
  parsing mutates or re-serialises it. Parsing a re-serialised body for
  verification is a defect: signatures are computed over raw bytes.
- Response contract: on verified, well-formed events, acknowledge quickly
  (HTTP 200) and queue heavy work to Redis/BullMQ for asynchronous
  processing. The webhook itself must not perform state transitions,
  financial decisions or acceptance decisions — it only verifies,
  deduplicates (§1.3) and enqueues. Slow synchronous work in the webhook
  is a defect (it risks Meta retries and duplicate delivery).
- On verification failure: reject (HTTP 403 or 401 per Sprint 2's
  documented choice — the choice must be written down in Sprint 2, not
  left implicit) and write an AuditEvent for the rejected attempt. Do
  NOT acknowledge a rejected event as processed.

### 1.2 HMAC SHA-256 verification steps (exact order)

Prerequisite variable names only: `WHATSAPP_APP_SECRET` (the secret used
to compute the signature) and, for sending, `WHATSAPP_ACCESS_TOKEN`
(never a value; rotation/hand-over is a Sprint 5 delivery item).

1. Read the signature header supplied by Meta on the request
   (header name per Meta's current Cloud API documentation, to be
   pinned in Sprint 2 code review — Sprint 1 does not hard-code a
   header string that Meta may rename without notice; Sprint 2 must
   record the exact header it implements and test against it).
2. Read the RAW request body bytes exactly as received.
3. Compute HMAC-SHA-256 over those raw bytes using the app secret
   (environment variable value at runtime, never in code or files).
4. Compare the computed digest with the supplied signature using a
   CONSTANT-TIME comparison (timing-safe equality). A normal string
   equality comparison is a defect — it leaks timing information.
5. On mismatch, missing signature, or missing secret configuration:
   REJECT the request, do NOT process, store or act on any event in the
   body, do NOT create MessageLog rows for its messages, and write an
   AuditEvent recording the rejection (no secret, signature value or
   body secret in the audit details — record only that verification
   failed, when, and the request's non-sensitive identifiers).
6. On match only: proceed to idempotency (§1.3), then enqueue.
7. Negative test (CORE PROMPT critical test 1, Sprint 2/4): a webhook
   with a wrong signature is rejected and produces no MessageLog row,
   no state change and no outbound message. A test suite without this
   negative test is incomplete.

### 1.3 Idempotency by whatsapp_message_id

- Key: `MessageLog.whatsapp_message_id` (UNIQUE in the database).
- Rule: the first verified processing of an id creates exactly one
  MessageLog row and one set of effects; any later delivery of the same
  id (Meta retry, duplicate webhook, re-queued job) is recognised and
  processed with NO duplicate effect: no second MessageLog row, no
  second state change, no second outbound message, no second audit
  effect beyond a single "duplicate recognised" audit note if Sprint 2
  chooses to log it.
- Implementation notes for Sprint 2 (design only): rely on the database
  UNIQUE constraint as the backstop, not on an in-memory set (which is
  lost on restart); handle the unique-violation path explicitly as
  "duplicate, already processed" rather than as a generic 500 error;
  make the enqueue + MessageLog insert atomic enough that a crash
  between them cannot double-process (Sprint 2 must document its chosen
  atomicity mechanism and test crash-retry behaviour).
- Negative/positive tests (critical test 2): duplicate event → no
  duplicate effect (assert MessageLog count, state, and outbound count
  unchanged); different ids → independent processing.

### 1.4 Message-status handling (sketch)

- MessageLog.status values: QUEUED → SENT → DELIVERED → READ, plus
  FAILED from any state. Statuses NEVER downgrade, except to FAILED.
  Example: a DELIVERED status arriving after READ must be ignored for
  status purposes (logged, not applied); a FAILED status always applies.
- The downgrade rule is a Sprint 2 Guard (the enum alone cannot express
  ordering — see schema comment). Sprint 4 must test: out-of-order
  status delivery does not move status backwards.
- Inbound vs outbound: MessageLog.direction distinguishes INBOUND
  (customer → system) from OUTBOUND (system → customer). Internal staff
  notes are NEVER MessageLog OUTBOUND rows and are never sent: they
  belong to the operations panel as centred system notices in Sprint 3
  (PB-13), not to this webhook contract.

## 2. Sending contract — SKETCH (no send happens in Sprint 1)

- Send path (relative, Sprint 2 configuration): Cloud API message-send
  endpoint for the configured test phone-number id (variable name only:
  `WHATSAPP_PHONE_NUMBER_ID`; no value, no number here).
- Every send attempt, successful or not, is recorded in MessageLog
  BEFORE it is described anywhere as "sent": a row with status QUEUED/
  SENT/FAILED, template fields (§3), direction OUTBOUND, and
  is_dry_run flag (§4). A message with no MessageLog row must never be
  described as sent.
- Sending is NEVER triggered by a state transition alone: a transition
  may enqueue a notification job, but the job still passes template,
  window (§3) and human-review rules before any send. No auto-send of
  acceptance, settlement or funding content without the Sprint 2/3
  human-review gate that the operations panel defines.
- A send failure must be visible to staff with Meta's error/reason
  (non-sensitive part only), must NOT be retried blindly in a loop,
  and must NOT be relabelled as success. Retry policy (counts, backoff,
  dead-letter) is a Sprint 2 design decision to be written down, not
  improvised in code.

## 3. Templates and the 24-hour window

- Rule: free text INSIDE the 24-hour customer-service window; approved
  Utility templates ONLY outside it. The window is measured per
  customer conversation from the customer's last message, per Meta's
  rules as implemented and tested in Sprint 2 — Sprint 1 does not invent
  a window calculation.
- Local vs Meta approval are SEPARATE fields, shown SEPARATELY to staff:
  MessageLog.template_local_approval and
  MessageLog.template_meta_approval, plus template_rejection_reason.
  The four combinations and their sendability:

  | Local approval | Meta approval | Sendable? |
  | --- | --- | --- |
  | APPROVED | APPROVED | Yes (subject to window + review rules) |
  | APPROVED | REJECTED | NO — un-sendable; rejection reason MUST be shown to staff |
  | APPROVED | PENDING | NO — not yet sendable as a template outside the window |
  | REJECTED (local) | any | NO — staff must fix/replace the template first |

- A template approved locally but rejected by Meta MUST NOT be sent by
  falling back to free text outside the window, by renaming it, or by
  any other bypass. The bypass itself would be a defect.
- Template catalogue (names, languages, Utility category) is Sprint 3
  content (PB-12), configured only from templates actually approved by
  Meta for the test account first, then migrated with the final account.
  No template name is promised in this Sprint 1 sketch as "approved":
  approval is a Meta fact, verified at Sprint 2/3 test time.

## 4. Dry-run labelling

- MessageLog.is_dry_run = true marks a SIMULATED send. Rules:
  - Labelled "dry-run" EVERYWHERE it is displayed (panel, logs, reports,
    chat transcripts). A dry-run row shown without the label is a defect.
  - Never counted as a sent message in any total, status or report.
  - Never described in chat, documentation or a Sprint report as a
    message that was "sent" without the dry-run qualifier in the same
    sentence.
  - Dry-run mode is the DEFAULT for Sprint 1 test-path demonstrations
    and for any demonstration before the final account migration. Real
    sends require an explicit, non-dry-run configuration + test-account
    verification in Sprint 2, recorded in writing.

## 5. Test-path procedure (design — to be executed in Sprint 1/2, not here)

1. Configure test Meta account / test numbers (values in the test
   environment's secret store only, never in the repo or this document).
2. Subscribe the webhook (GET verification) and confirm the handshake
   succeeds with the correct verify token and fails with a wrong one.
3. Send a test inbound message on the test number; confirm: HMAC passes,
   MessageLog row created with the correct whatsapp_message_id,
   direction INBOUND, and status recorded without downgrade.
4. Re-deliver the SAME webhook payload; confirm: no duplicate MessageLog
   row, no duplicate effect (critical test 2).
5. Deliver a payload with a deliberately wrong signature; confirm:
   rejection, no MessageLog row, audit entry for the rejection
   (critical test 1).
6. Send a test template inside and outside the 24-hour window (test
   account); confirm: inside-window free text allowed, outside-window
   template-only enforced, locally-approved-but-Meta-rejected template
   blocked with reason visible.
7. Run the same sequence in dry-run mode; confirm every dry-run row is
   labelled dry-run and no dry-run total is reported as sent.
8. Record the results as the Sprint 1 test-path evidence (test account
   identifiers masked, no secret values). "Test path works" may only be
   claimed after steps 2–7 pass and are recorded — not from this sketch.

## 6. Configuration — variable NAMES ONLY

The following environment variable names are the complete Sprint 1
configuration surface for WhatsApp. No other WhatsApp secret, token or
number may be introduced without updating this list and the Sprint 2
security review:

- `DATABASE_URL` — PostgreSQL connection (Prisma datasource; name only).
- `WHATSAPP_APP_SECRET` — HMAC verification secret (name only).
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN` — subscription verification token
  (name only).
- `WHATSAPP_ACCESS_TOKEN` — Cloud API send token (name only; test
  account in development, final client-owned account after migration).
- `WHATSAPP_PHONE_NUMBER_ID` — Cloud API phone-number id (name only;
  test number in development, final number after migration).
- `WHATSAPP_API_VERSION` — Cloud API version string used by Sprint 2
  (to be pinned in Sprint 2; the v3.1 stack note records Graph API
  v26.0 as the reference version at design time — Sprint 2 must confirm
  the live version at implementation time and record any change).

No `.env` file is created by Sprint 1 work. A future `.env.example`
(Sprint 0/1, other worker's scope) may list these NAMES with empty
values; it must never contain values.

## 7. Skeleton vs build — what is what, and when

| Item | Sprints 0–1 (this work) | Sprints 2–3 (future work, NOT done here) |
| --- | --- | --- |
| Webhook contract (§1) | SKETCH in this document only | Runnable NestJS handler + HMAC + enqueue (PB-11) |
| HMAC verification (§1.2) | Step list + reject rules | Implemented, constant-time compare, tested (critical test 1) |
| Idempotency (§1.3) | Rule + UNIQUE key in schema | Implemented, duplicate-effect test (critical test 2) |
| MessageLog table | Prisma model + migration (PB-04) | Written by webhook + send paths; status-monotonicity Guard |
| Template approval separation | Two fields in schema + §3 table | Panel display (separate columns) + un-sendable enforcement (PB-12) |
| 24-hour window | Rule stated (§3) | Implemented + tested inside/outside window (PB-12) |
| Dry-run labelling | Rule + is_dry_run field (§4) | Panel labelling + reporting exclusion (PB-12) |
| Test path (§5) | Procedure designed | Procedure EXECUTED on test account; evidence recorded (PB-14) |
| Final account migration | Ownership + migration principle stated | Executed only when final account/number ready; permissions handed over (PB-14) |
| Inbox triptych / composer | NOT in this document (PB-13, Sprint 3) | List \| chat \| details, assignment, notes, composer (PB-13) |
| Real sends | NONE — forbidden in Sprints 0–1 | Test-account sends in Sprint 2; final-account sends only after migration + written acceptance |
| BSP / intermediary | EXCLUDED from baseline | Considered ONLY on insurmountable direct-linking obstacle + written approval |
| Financial decisions via WhatsApp | FORBIDDEN (message ≠ confirmation) | Still forbidden: evidence, coordination and settlement stay manual + staff-recorded |

What this document deliberately does NOT contain: executable code, a
host URL, a token, a number, an account id, a template that is claimed
approved, a send log, or a claim that the test path has been executed.
Any such content appearing under a Sprint 1 label is out of scope and
must be removed or relabelled with its true Sprint before acceptance.
