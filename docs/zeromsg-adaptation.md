# ZeroMsg adaptation — what Pilot took, changed, and rejected (Stage B)

Stage A is documented in `docs/zeromsg-study.md` (what was studied) and
`docs/zeromsg-linking.md` (Embedded Signup). This file is the Stage B
record: automation **execution** and real **file upload**. ZeroMsg
itself was not copied: its README mentions a "drag-and-drop automation
flow builder" and a "real-time team inbox" but gives no trigger/step
catalogue, no execution semantics, and no file-handling feature at all.
Everything below is therefore Pilot's own design on Pilot's own stack
(React + Vite + TypeScript frontend, Node built-ins backend — no PHP,
no Laravel, no new dependency).

## 1. Automation execution (was storage-only, now executes)

### Where it runs
- Inbound: inside the existing webhook handler, **awaited** after the
  inbound message is stored, so the webhook response and any test that
  reads messages immediately afterwards see the automation's outbound
  message. Automation never fails the webhook: an execution exception
  is swallowed and the webhook still returns 200.
- Contract events: inside the existing contract-transition handler,
  after the state change and its audit entry, for both the buyer and
  the seller conversation of that contract.
- Manual: `POST /api/workflows/:id/run` and
  `POST /api/automation/rules/:id/run` (both require `automation:edit`,
  both take `conversation_id`).

### Triggers (workflows and rules share the same engine)
Priority on an inbound message, in this order — only one winner runs,
except contract-event triggers (see below):
1. **Ask-question continuation** — if the conversation is waiting for a
   reply, any new inbound resumes that flow instead of matching a new
   trigger.
2. **Handoff** — if the conversation is handed off, nothing runs until
   a human resumes it.
3. **Keyword** — Arabic-normalised (diacritics and tatweel stripped,
   أ/إ/آ → ا, ؤ → و, ئ/ى → ي, ة → ه, whitespace collapsed) on both
   sides. **Exact match beats contains; among ties the longest
   trigger wins.**
4. **Button/list reply** — trigger value matches the reply title or
   reply id (interactive messages now store both fields).
5. **First message** — no prior inbound message in that conversation.
6. **Business-hours / away** — `trigger_value` may be `HH:MM-HH:MM`
   (server local time; default 09:00–17:00; overnight ranges work).
   `business_hours` fires inside the range, `away` outside it.
7. **Fallback** — only after **2 unknown messages** in that
   conversation (a match resets the counter; the fallback run resets it
   too, so it does not fire on every later message).
8. **Contract-event** — `trigger_type` `contract_event` or
   `contract-event`, `trigger_value` equal to the new state (or
   `state:<state>`). All matching contract-event flows run for each
   party conversation; this is the one trigger that runs more than one
   flow, because different flows may serve buyer vs seller.
9. **Manual** — the run endpoints above; manual runs bypass cooldown
   but never bypass a handoff or a money-step rejection.

### Actions (step vocabulary)
Both the designer's existing step names and the explicit names below
are accepted: `text`/`send_text`, `template`/`send_template`,
`image`/`video`/`audio`/`document`/`send_media`, `buttons`, `list`,
`question_text`/`question_number`/`media_request`/`ask_question`
(send the question, then **wait**: the next inbound resumes the flow
at the following step), `condition`/`branch` (structured fields
`if_contains`/`contains` or `if_equals`/`equals` with `then`/`else`
step arrays; a purely textual `condition_expr` from the old designer
is logged as `condition_unstructured_skipped` and execution continues
linearly — it is not guessed at), `assign`, `add_label`/`label`
(stored on `conversation.labels`), `add_note`/`note` (internal note,
never shown to the customer), `create_task`/`task` (ops task, type
`automation`), `webhook_out`/`webhook` (POSTs only
`{event, conversation_id, workflow_id, workflow_name}` — **no phone
number, no message text, no secret** — to an operator-chosen URL,
5 s timeout, result logged), `delay` (see limitation below),
`handoff`/`human_handoff`/`handover` (sets `automation_handed_off`,
stops the flow, later steps do not run), `end`, and the old generic
`action` (logged only, no external effect).

### Guards (all audited, all logged to `automation_logs`)
- **Kill Switch** blocks the whole run: no automation send of any
  kind while it is on, and a `blocked_kill_switch` log entry is
  written when a would-be run is blocked.
- **Cooldown:** 60 s per conversation+flow (manual runs and
  ask-question continuations bypass it; human resume clears it).
- **Loop guard:** at most 5 automation runs per conversation per
  minute, and at most 20 steps per run (a longer flow is truncated
  and logged as `truncated_loop_guard`).
- **Handoff:** `POST /api/conversations/:id/automation/handoff`
  (automation:edit) stops automation; `.../resume` clears the handoff,
  the waiting pointer, the unknown counter and cooldowns. State is
  readable at `GET /api/conversations/:id/automation`; the log is
  readable at `GET /api/automation/logs` (filters: conversation_id,
  workflow_id, outcome).
- **Template send gate (Stage A, re-applied):** a template step
  requires local approval AND, when Meta is configured, Meta
  approval; otherwise it is logged as `send_blocked` with
  `template_not_meta_approved` (or `template_not_approved` /
  `template_not_found`) and nothing is sent. Free-form text/media/
  buttons/list steps require an open 24 h window, like a manual send.
  When Meta is **not** configured, an automation send is recorded as
  a **dry-run** message (`dry_run: true`) and is never reported as
  sent.

### Money: rejected at save AND at execution
`hasBannedStep` is recursive (condition `then`/`else` branches are
checked too) and covers `release_money`, `refund_money`,
`confirm_payment`, `settle_dispute`, `release_payment`,
`refund_payment`, `payment_confirm`, `release_funds`, `refund_funds`,
plus any `contract_transition`/`state_change` step whose target is
`payment_confirmed`, `refund_pending` or `refunded`. Workflow/rule
create and update reject such steps with 400; the manual-run endpoints
reject them with 400; and `runAutomation` re-checks every step (and
every nested branch) at execution time, logs
`blocked_money_step`, audits `automation_rejected_money_step`, and
executes nothing. Execution-time rejection is tested with a banned
flow injected into a fresh child server process, because the save-time
gate correctly refuses to create one through the API. Payment
confirmation, release and refund therefore stay human-only, with an FI
reference, exactly as before.

### Limitations (honest)
- `delay` steps wait at most 2 s inside the webhook (longer delays
  are logged with their full intended duration but do not block the
  webhook response); there is no persisted delayed-job queue yet.
- An ask-question step nested inside a condition branch resumes at
  the next top-level step after the condition, not inside the branch.
  Top-level ask-question flows (the normal case) resume exactly.
- Business-hours uses the server's local clock, not a per-client
  timezone setting; on Render that is UTC unless the host sets TZ.
- Webhook-out is fire-and-forget with a logged status; there is no
  retry queue and no signing of the outbound payload yet.

## 2. File upload (was metadata-only, now real files)

### Endpoint
`POST /api/whatsapp/upload` (`whatsapp:edit`, audited, raw
multipart/form-data parsed with Node built-ins only — no new
dependency). It is handled **before** the JSON body parser, which
would otherwise discard the file. Fields: `file` (required),
`conversation_id` or `to` (optional; when present the file is also
sent), `caption` (optional).

### Caps, types, storage — the exact choices
- **Size cap: 16 MiB for every type** (image, video, audio and
  document alike). Meta allows documents up to 100 MB, but that cap
  was deliberately NOT adopted: the free container has limited disk
  and request-timeout headroom, and 16 MB covers contract photos and
  documents on WhatsApp. Oversize returns 413 and stores nothing.
- **Allowed types (extension + MIME family must agree):**
  image `.jpg`/`.jpeg` (image/jpeg), `.png` (image/png);
  video `.mp4` (video/mp4), `.3gp` (video/3gpp);
  audio `.aac`, `.amr`, `.mp3`, `.ogg`, `.opus`;
  document `.pdf`, `.doc`, `.docx`, `.xls`, `.xlsx`, `.ppt`,
  `.pptx`, `.txt`. Anything else returns 400
  `unsupported file type`; renaming an `.exe` to `.png` is rejected
  because its MIME family does not match the extension.
- **Filename sanitisation:** path separators stripped, only
  `[A-Za-z0-9._-]` kept, leading dots removed, stem capped at 80
  chars. The response carries `filename` (sanitised) and
  `stored_filename` (timestamp + random + sanitised, so two uploads
  of the same name never collide). The stored path is never returned
  to the client.
- **Storage:** `backend/uploads/` on disk, gitignored (`uploads/` in
  `.gitignore`), never committed. Records live in `db.uploads`
  (metadata only: sanitised/stored names, MIME, kind, size, Meta
  media ID, conversation, uploader, dry-run flag). Staff can download
  a stored file at `GET /api/whatsapp/uploads/:id/download`
  (`whatsapp:view`, path confined to the uploads directory).

### Send flow
1. If a send is requested and the Kill Switch is on, the file and its
   record are deleted and the request returns 400 `kill_switch_on`.
2. If a send is requested and the 24 h window is closed, the file is
   **kept** (it can be sent later by media ID, or after a template
   re-opens the window) and only the send is refused with 400
   `outside_24h_window_use_template`.
3. If Meta is configured, the file is uploaded to Meta by hand-built
   multipart `POST /{phone-number-id}/media` to obtain a media ID,
   then sent **by media ID** (`POST /{phone-number-id}/messages`
   with `{id: media_id, caption?}`). A failed Meta upload returns
   502 with the local record; a failed send returns 502 with the
   media ID.
4. If Meta is not configured, the file is stored locally and, when a
   send was requested, a dry-run outbound message is recorded
   (`dry_run: true`) — never claimed as sent.

### Inbound media
The webhook now stores, for image/video/audio/document messages:
`media_id` (Meta's id), `media_caption`, `media_filename`
(documents), alongside `media_type` and the body (caption or
`[type]`). A download link is available only when Meta is configured:
`GET /api/whatsapp/media/:media_id` (`whatsapp:view`) calls Meta
`GET /{media-id}` and returns its (temporary) `download_url`; when
unconfigured it returns `configured: false, download_url: null`
instead of inventing a link.

### UI (small, in the inbox)
The inbox chat card now has: a file picker + caption + "رفع الملف
وإرساله" button (requires `whatsapp:edit`, explains the 16 MB cap,
the dry-run state and the 24 h rule), plus "تحويل لموظف (إيقاف
الأتمتة)" and "استئناف الأتمتة" buttons. The Automation section has
a manual-run form (flow + conversation) and an execution-log viewer.
No UI split into divided WhatsApp sub-views was done here — that is
the next stage.

## 3. Customised vs rejected from ZeroMsg (Stage B)

| ZeroMsg pattern | Pilot Stage B decision |
|---|---|
| Drag-and-drop flow builder (README only) | Customised: Pilot's existing designer (workflows + rules) now **executes**; trigger/action semantics, priority, guards and the log are Pilot's own (see §1). No drag-and-drop library was added. |
| Real-time team inbox, rich media | Customised: inbox replies stay local records; real media now goes through the upload endpoint above and is sent by Meta media ID, never by pasting a link and claiming a send. No websocket/"real-time" claim was added. |
| Developer API & outbound webhooks | Partially customised, narrowly: automation has a single `webhook_out` action to one operator-chosen URL with a minimal, secret-free payload. No general third-party API, no API keys. |
| Broadcast campaigns | **Rejected** — unchanged. No broadcast, no audience building, no marketing. |
| Multi-tenant workspaces | **Rejected** — unchanged. One client, one dedicated Cloud API number, accounts in the client's name. |
| Unofficial WhatsApp paths (Baileys/Evolution/WAHA/QR) | **Banned** — unchanged. Only the official Meta Cloud API, including for media upload. |
| Contacts & segments, CSV import/export | **Not done here** — next stage. Contacts must stay contract-scoped; no CSV import may create a broadcast audience. |
| UI split into divided WhatsApp interfaces | **Not done here** — next stage. |

## 4. Files changed in Stage B
- `backend/src/server.js` — automation engine, webhook/transition
  wiring, upload endpoint + media endpoints, recursive money ban.
- `backend/src/test.js` — 30 new Stage B checks (113 → 143), mocked
  Meta media upload (`/media` → `mock-media-123`) and media URL,
  plus uploads-directory cleanup on test exit.
- `frontend/src/api.ts`, `frontend/src/views.tsx`,
  `frontend/src/types.ts` — upload + automation controls, new
  trigger labels; `frontend/index.html` rebuilt from the Vite build.
- `.gitignore` — `uploads/` added.
- This file — Stage B record.

## 5. What remains for the next stages
- **Contacts & segments** (contract-scoped only, no broadcast
  audience, CSV rules to be defined by the parent).
- **UI split** into divided, luxurious WhatsApp interfaces (inbox /
  templates / connection / automation as separate sub-views) — the
  current UI additions are deliberately small.
- Later, if wanted: a persisted delayed-job queue (so `delay` steps
  wait their full duration), per-client timezone for business hours,
  signed/retried outbound webhooks, and exact resume inside condition
  branches.

## 6. Stage C — contacts + divided WhatsApp interfaces (final stage)

Stage C closes the two items section 5 left open. Nothing from Stages
A/B was redesigned: the 143 earlier checks still pass, and the total
is now **167 checks passing twice** (143 + 24 new Stage C checks).

### 6.1 Contacts: organised, contract-scoped only

New collection `db.contacts` (runtime JSON store; Postgres DDL notes in
`db/schema.sql`, Stage C block). One row per phone, enforced by a
format-insensitive duplicate check (spaces/dashes/`+` stripped before
comparing) — create and update return **409** on a clash.

| Endpoint | Permission | Behaviour |
|---|---|---|
| `GET /api/contacts` | `whatsapp:view` | Search `q` (name/phone/labels), `segment` (exact label), `role` (`buyer`/`seller`), `last_contact_after`/`last_contact_before`, `has_contract`, `eligible`. Sorted by most recent contact first, never-contacted last. |
| `POST /api/contacts` | `whatsapp:edit` | `phone` required, 7–15 digits with optional leading `+`; `name` defaults to the phone; `labels` (max 20, each max 50 chars), `notes` (max 1000 chars). |
| `GET /api/contacts/:id` | `whatsapp:view` | Detail panel data: the contact plus its linked conversations and contracts (see below). |
| `PUT/PATCH /api/contacts/:id` | `whatsapp:edit` | Same validation; phone change re-checks duplicates. |
| `DELETE /api/contacts/:id` | `whatsapp:edit` | Deletes only the address-book row — never its contracts, conversations or messages. Audited. |
| `POST /api/contacts/import` | `whatsapp:edit` | CSV text in JSON (`{csv}`), max 1000 data rows. Header must contain a `phone` column (`phone`/`phone_number`/`mobile`); optional `name`, `labels`/`label`/`segments`/`segment`, `notes`/`note`. Returns `{total, created, skipped, errors, created_ids, details, error_rows}` where each detail row names its outcome (`created`, `skipped` with `duplicate_existing` or `duplicate_in_file`, `error` with `invalid or missing phone`). A bad row never stops the rest of the file. |
| `GET /api/contacts/export` | `whatsapp:view` | Real `text/csv` download (BOM + header `name,phone,labels,notes,roles,last_contact_at,utility_eligible`), not a JSON blob pretending to be a file. |

**Permission choice (documented, deliberate):** contacts use the
existing `whatsapp` family (`whatsapp:view` / `whatsapp:edit`) — the
same family as templates and uploads. There is deliberately no
separate contacts permission. Role defaults grant `whatsapp` only to
`owner`, so other roles need an explicit `whatsapp` section/action
override to use contacts at all; a `viewer` gets 403 on both read and
write (tested).

**Detail links (computed, never stored):** for a contact's phone, the
backend derives from existing data only — contracts where the phone
is buyer or seller (with role, code, state), conversations for that
phone (contract buyer/seller conversations plus `general`
conversations for the phone), `last_contact_at` (latest non-internal
message in those conversations), and `message_count` (internal notes
excluded). A contact with no contract shows empty links and says so;
it never creates a contract, a conversation, or an audience.

**Opt-in / Utility-eligibility rule (documented, not invented
consent):** `utility_eligible` is **computed**, never typed in by
staff, and creating a contact never grants it. It is true only when
the phone has (a) a prior **inbound** message, or (b) an outbound
template message **actually sent via Meta** (`dry_run` false and a
Meta `wamid` present). Staff-local `/api/messages` records, internal
notes and dry-run records never confer it. Eligibility is a record
of a past interaction, **not consent**: every send still has to pass
the 24 h window / approved-template gate. The UI states this rule on
the contacts page and on every detail panel.

**Never a broadcast audience:** there is no broadcast, campaign or
bulk-send endpoint anywhere in the server, and Stage C adds none
(tested: `POST /api/contacts/broadcast` returns 404). Import and
export move address-book rows only; they cannot address a send to
more than one recipient, because no such send path exists.

### 6.2 WhatsApp interfaces: divided, not one long page

The WhatsApp section is now 7 sub-interfaces, reached identically
from the phone top tab bar and the desktop sidebar sub-nav (same
permission gating in both; the 820 px breakpoint and the dark teal
`#0f3d3a` luxurious styling, large numbers, SVG icons and light
grey-blue page are unchanged):

| Sub-interface (label) | Owns — and nothing else |
|---|---|
| **الربط والحسابات** (`connection`) | Embedded Signup card + connection wizard (7 server steps, now with a step search/status filter) + the Webhook status card. The old standalone `webhook` sub was folded here, not kept as an eighth page. |
| **الإنبكس** (`inbox`) | Reuses the existing `Inbox` component (list + chat + reply + handoff/resume). Requires **both** `whatsapp` and `inbox` sections — a user with only one cannot reach it through this route. |
| **القوالب** (`templates`) | The existing `Templates` component only (create/edit draft, submit/sync, local vs Meta status), now with a search bar and a status filter (sendable / locally approved / Meta approved / not submitted). |
| **الأتمتة** (`automation`) | Reuses the existing `Automation` component (manual run, execution log, rules, Kill Switch). Requires **both** `whatsapp` and `automation` sections. The rules card gained a search bar. |
| **جهات الاتصال** (`contacts`) | The new `Contacts` component only (list, detail panel, create/edit, CSV import with report, CSV export). |
| **الوسائط** (`media`) | The new `WhatsAppMedia` component only: the upload form (file + conversation + caption, 16 MB cap, Meta media-ID send or dry-run), the uploads library with download (Bearer-token blob fetch — a plain link would 401), and the Meta inbound-media download-link lookup. |
| **الإعدادات** (`settings`) | Environment-variable **names** only, now with a search bar. No value, token or secret field exists anywhere in it. |

**No duplication (the Stage C rule, applied):** the file-upload form
moved out of the inbox chat card into **الوسائط** — the inbox now
carries only a short note pointing there, so the upload tool exists
in exactly one place. Embedded Signup, the wizard, templates,
automation controls/logs, upload and contacts each live in their one
sub-interface above; inbox/automation subs reuse the same components
as the main Inbox/Automation tabs rather than copying them.

**Every sub-interface** has an empty state (e.g. "لا جهات اتصال
مطابقة", "لا وسائط مرفوعة بعد", "لا قوالب مطابقة للبحث"), a
search/filter bar, and the same card/table style as the rest of the
app. Phone top tabs gained `جهات الاتصال` and `الوسائط` pills (both
`whatsapp`-gated); the active-tab mapping routes each WhatsApp sub
to its matching top pill.

### 6.3 Files changed in Stage C
- `backend/src/server.js` — contacts helpers + 7 endpoints + export
  CSV writer; `contacts` added to the data-file migration list.
- `backend/src/test.js` — 24 new Stage C checks (167 total).
- `frontend/src/types.ts` — `Contact`, `ContactImportReport` types.
- `frontend/src/api.ts` — contacts CRUD/import/export + blob
  download helpers (`reqText`, `reqBlob`); no secret is ever sent.
- `frontend/src/views.tsx` — `Contacts`, `WhatsAppMedia`; upload
  moved out of `Inbox`; search/filter bars on Templates, Automation
  rules, wizard steps and WhatsApp settings; Webhook card folded
  into connection.
- `frontend/src/App.tsx` — 7 WhatsApp subs, 2 new phone top tabs,
  dual gating for the inbox/automation subs, new rendering branches.
- `frontend/index.html` — rebuilt from the Vite build (contains all
  7 sub-interface labels; verified by a backend test reading the
  built file).
- `db/schema.sql` — Stage C additive notes (`contacts` table with a
  normalised-phone unique index, `whatsapp_uploads` table; bytes stay
  on disk, never in the DB).
- This file — Stage C record + final summary below.

## 7. Final summary — copied, customised, deliberately rejected

ZeroMsg (megoxv/zeromsg, MIT, PHP 8.3 + Laravel 13 + Inertia React)
was studied, never forked or ported. Its README-level features were
the input; every behaviour below is Pilot's own implementation on
Pilot's own stack.

### Copied (pattern only, re-implemented)
- **Team inbox** — per-party conversations with assignment, status,
  unread counts, internal notes kept out of the customer view.
- **Template management with sync from Meta** — local draft +
  submit + sync, with Meta status kept separate from local approval.
- **Automation flow builder, executing** — workflows + rules with
  triggers and steps, an execution log, and a manual-run control.
- **Contacts & segments with CSV import/export** — Stage C, in the
  contract-scoped form described in §6.1.
- **Embedded Signup** — official Meta launch + test-only callback
  (no token stored; production persistence is Render env + Redeploy).

### Customised for contracts (Pilot-only behaviour)
- Every WhatsApp surface is gated by contract rules: the 12-state
  machine, FI-reference payment confirmation, human-only money steps
  (rejected at save **and** execution, recursively through condition
  branches), append-only audit, Kill Switch, 60 s cooldown, loop
  guard, 24 h window, Arabic-normalised keyword priority
  (exact-before-contains, longest wins), ask-question-and-wait,
  business-hours/away, fallback after 2 unknowns, handoff/resume.
- Templates are **Utility-only, Arabic-only**, with the dual
  local+Meta approval send gate and dry-run when unconfigured.
- Files go through a 16 MB, extension+MIME-checked upload, are sent
  **by Meta media ID**, and inbound media is metadata + a Meta
  download link only when configured.
- Contacts derive roles, conversations, last contact and Utility
  eligibility from contracts/messages instead of being a free-form
  CRM, and the WhatsApp UI is divided by operations job (connection /
  inbox / templates / automation / contacts / media / settings).

### Deliberately rejected, and why
- **Marketing campaigns / broadcasts** — Pilot's customer interface
  is contract service messaging only. A broadcast audience would
  turn contract contacts into a marketing list and break the Utility
  contract with Meta; contacts therefore have no bulk-send path at
  all (and no endpoint to add one to).
- **Catalogs / in-chat payments** — a marketplace and in-chat
  payments would move money inside the system. Money stays with the
  external financial institution under manual coordination; the
  system never holds a balance, never confirms a payment without an
  FI reference, and never lets automation touch money.
- **Unofficial WhatsApp paths (Baileys / Evolution / WAHA /
  QR-linked-device, WhatsApp Web automation)** — banned. Only the
  official Meta Cloud API, on a dedicated Cloud API number (never a
  normal WhatsApp app number), in the client's name.
- **AI selling / AI replies that close deals** — automation may
  answer, ask, label, assign and create ops tasks, but it may not
  negotiate, confirm or settle anything financial; handoff to a human
  is a first-class step, not a fallback.
- **Multi-tenant workspaces as a separate product** — rejected. One
  client, one dedicated number, accounts in the client's name.
  Workspace-style separation would invite running several clients'
  money flows through one deployment.
- **Demo-data seeding** — rejected. The system starts empty:
  production data starts empty, contacts are never seeded, and the
  10 seeded items are only the Utility template *shells* (names and
  labels, no body text claimed as approved). Empty states render `0`
  with the same luxurious treatment as populated ones; nothing is
  ever presented as real until the client creates or approves it.

## 8. Stack justification — why Node built-ins + TypeScript + SQL notes, no second system

- **One stack, already deployed:** React + Vite + TypeScript
  frontend and a Node built-ins backend were the running Pilot System
  (private repo, Render auto-deploy). Introducing Laravel/PHP would
  have created a second system to host, secure and keep in sync with
  the contract machine — for zero contract behaviour that PHP would
  have added.
- **Zero new dependencies:** the backend still uses only Node
  built-ins (`http`, `crypto`, `fs`, `path`). That keeps the free
  Render container deployable from the same repo with the same
  commands, keeps the test suite runnable with plain `node
  src/test.js`, and keeps the security surface to code the team can
  read (multipart parsing, HMAC verification and Meta calls are all
  hand-built and audited in the same file).
- **TypeScript on the frontend only:** it types the API contract
  (contacts, templates, uploads, wizard steps) so UI/backend drift
  fails the build instead of reaching the client; the backend stays
  dependency-free JavaScript so the test harness can spawn and drive
  it without a compile step.
- **SQL notes, not a second store:** `db/schema.sql` is the
  production Postgres target for the same API shape. The runtime
  JSON store is explicitly the local/dev store; the schema notes are
  additive and commented, so switching stores changes no endpoint,
  permission or state-machine rule. A full Postgres migration is a
  deployment step for real client data (see §9), not a rewrite.

## 9. What remains (after Stage C)
- **GitHub push (not done by this stage, by instruction):** commit
  and push Stage C to `ahmedassem123x-web/Pilot-System` `main`;
  Render auto-deploys on push. Verify the live URL afterwards.
- **Client-side Meta setup (in the client's name only, never in
  chat or repo):** Business verification, WABA, dedicated number +
  OTP, display name, system-user permanent token, webhook
  subscription, then `WHATSAPP_*` env vars in Render + Redeploy,
  Test Token, test message, template approval. No Meta token is
  ever pasted into chat, a file, or this repo.
- **Before real client data:** Postgres persistence (the JSON file
  store is not production storage), a real-device touch test (first
  phone top-tab tap on each new WhatsApp sub, desktop sidebar),
  login + contract-flow test on the live URL, and the 3-round real
  testing pass.
- **Known follow-ups (unchanged):** template-send gate currently
  uses local approval + Meta approval (documented); button payload
  shape to confirm against Meta docs before the first real send;
  no live Meta test yet, only mocked tests; persisted delayed-job
  queue, per-client timezone for business hours, signed/retried
  outbound webhooks, and exact resume inside condition branches
  remain future work if wanted.
