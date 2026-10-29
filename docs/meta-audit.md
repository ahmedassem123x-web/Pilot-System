# Meta / WhatsApp audit — Pilot System (Stages 1–3: audit only)

**Date of audit:** 2026-10-29
**Scope of this document:** What the standalone codebase in this folder
actually does today about Meta / WhatsApp, what is missing, what is
unnecessary, and what is misleading. No code was changed for this audit.
No credential, token, secret, phone number, WABA ID, or Meta account value
appears in this document — only names of variables, endpoints, and files.

**Codebase audited (local copy):** `backend/src/server.js` (854 lines),
`backend/src/test.js` (223 lines), `frontend/src/*.tsx|ts`
(`App.tsx`, `api.ts`, `components.tsx`, `icons.tsx`, `main.tsx`,
`types.ts`, `views.tsx`, `workflow.tsx`), `db/schema.sql` (12 tables),
`README.md`, `backend/README.md`, `docs/provider-dashboard-structure.md`,
`docs/state-machine.md`, `.env.example`, `Dockerfile`, `railway.json`
(205 bytes: Railway Dockerfile builder, 1 replica, restart on failure),
`docker-compose.yml`.
Local git HEAD at audit time is `fd94c29` ("dark teal Preview redesign").
The task brief states GitHub `main` is at `68e3982b` with the same
description; this audit covers the files in this folder, not the remote.

**Bottom line up front:** the system has a webhook *shell* and a
local template list. It has **no real Meta connection**: nothing sends a
message to WhatsApp, nothing routes a real inbound message into the
inbox, nothing reads or writes anything at Meta, and nothing verifies
that any template was ever approved by Meta. Several screens present
local state as if it were Meta state. The webhook POST handler also has
two signature defects (Section 3) that would break or bypass real Meta
verification and must be fixed before any real traffic, in a later
coding stage — not in this document.

---

## 1. What exists today (verified by reading the code, not assumed)

### 1.1 Webhook endpoint — `backend/src/server.js`

- `GET /api/whatsapp/webhook` (server.js, webhook block near line 356):
  reads `hub.mode`, `hub.verify_token`, `hub.challenge`; returns the
  challenge with HTTP 200 only when `mode === 'subscribe'` and the token
  exactly equals `process.env.WHATSAPP_VERIFY_TOKEN`; otherwise 403
  `webhook verification failed`. This is the correct *shape* of Meta's
  verification handshake. It is untested by `test.js` (no webhook test
  exists there at all).
- `POST /api/whatsapp/webhook` (same block): public by design (no login
  token required, correctly, since Meta calls it). It reads the
  `x-hub-signature-256` header, and **only if both**
  `WHATSAPP_APP_SECRET` and the header are present, compares an
  HMAC-SHA256 digest. It then stores one row in `db.messages` and one
  audit row (`actor: 'whatsapp-webhook'`, action `inbound_received`),
  and returns 200 `{ ok: true, message_id }`. See Section 3 for why this
  handler does not work for real Meta payloads.
- No other route calls Meta. A full-text search of `backend/src/`,
  `frontend/src/`, `README.md`, and `backend/README.md` finds **no**
  occurrence of `graph.facebook.com`, no outbound `fetch` to Meta, and
  no use of `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`,
  or `WHATSAPP_API_VERSION` anywhere in code. Those three names appear
  only in `.env.example` and in the frontend settings screen text.

### 1.2 Status endpoint — `GET /api/whatsapp/status`

- `backend/src/server.js`, requires `whatsapp:view` permission.
- Returns exactly: `health: true` (hardcoded), three booleans
  (`webhook_verify_configured`, `webhook_hmac_configured`,
  `whatsapp_access_configured` — each is only "is this env var
  non-empty"), and two counts (`templates_total`,
  `templates_approved`, counted from the local template list).
- Good: it never returns a secret value. Bad: see Section 4 — `health`
  and the booleans do not prove any connection to Meta.

### 1.3 Templates — local list only

- `seedTemplates()` in `server.js` seeds exactly 10 templates on first
  run, all `language: 'ar'`, all `category: 'UTILITY'`, all
  `approval_status: 'pending'`, with **no message body text, no
  components, no parameters, no Meta template ID, and no Meta status
  field**. Names (with Arabic labels in `TEMPLATE_LABELS_AR` /
  `frontend/src/types.ts` `TEMPLATE_AR`):
  `contract_created`, `invite_accept`, `contract_accepted`,
  `payment_request`, `payment_confirmed_fi`, `preparing`,
  `delivery_confirmed`, `transaction_closed`, `dispute_opened`,
  `handover_support`.
- `GET /api/templates` (requires `whatsapp:view`); `PUT|PATCH
  /api/templates/:id` (requires `whatsapp:edit`) changes **only**
  `approval_status`, and only to `pending` / `approved` / `rejected`
  (anything else → 400). No endpoint creates, edits the text of, or
  deletes a template, and no code contacts Meta's template API.
- `db/schema.sql` table `whatsapp_templates` *does* declare a `body
  TEXT NOT NULL` column — the runtime template objects have no body, so
  the schema and the runtime disagree (see Section 5).
- `backend/src/test.js` asserts "10 templates seeded" and that a `PUT`
  to `approval_status: 'approved'` succeeds. That test proves the local
  flag can be flipped; it proves nothing about Meta.

### 1.4 Inbox "replies" — local rows only

- `POST /api/conversations/:id/reply` and `POST /api/messages`
  (`server.js`) write a row to `db.messages` with `direction: 'out'`
  and an optional `template_name`. Nothing is transmitted anywhere.
- `frontend/src/views.tsx` (Inbox view) then shows the message
  "تم إرسال الرد." ("The reply was sent."). That wording is false for
  any real customer: the row was only saved locally (see Section 4).
- Workflow step type `template` (`frontend/src/workflow.tsx`,
  `frontend/src/types.ts` `STEP_TYPES`) lets a flow designer pick one
  of the 10 local template names, but **no workflow or automation rule
  is ever executed**: there is no trigger evaluation, no send step,
  and no code path from a workflow/rule to any message. Workflows and
  rules are stored, listed, copied, reordered, and deleted only.
  The money-step ban (`release_money`, `refund_money`,
  `confirm_payment`, `settle_dispute` → 400) is genuinely enforced and
  must stay enforced in every later stage.

### 1.5 Connection checklist — static in two places

- `GET /api/connection-checklist` (`server.js`, `CHECKLIST_STEPS`)
  returns the same 10 steps on every call, every step
  `status: 'pending'`, regardless of environment or Meta state. Steps:
  1 `meta_business`, 2 `dedicated_number`, 3 `fi_agreement`,
  4 `templates_approval`, 5 `env_vars`, 6 `webhook_hmac`,
  7 `test_message`, 8 `full_cycle_test`, 9 `backup_monitoring`,
  10 `client_acceptance`.
- The frontend has a *second*, separate checklist:
  `frontend/src/types.ts` `CHECKLIST` (10 items, slightly different
  wording) rendered by `Checklist()` in `views.tsx` with checkboxes
  stored in browser `localStorage` only (`api.ts` `local.checklist()`).
  Ticking a box proves nothing about the server or Meta.
- The WhatsApp tab (`frontend/src/App.tsx`: sub-tabs `connection`,
  `templates`, `settings`, `webhook`) renders the server checklist
  plus a 4-item static list (Meta Business → WABA/number → Webhook →
  template approval). None of these items is computed from live state.

### 1.6 Environment variables — names only, one name missing

`.env.example` (names only, no values — correct) already declares:

- `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`,
  `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`,
  `WHATSAPP_BUSINESS_ACCOUNT_ID`, `APP_BASE_URL`
- plus `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `ADMIN_EMAIL`,
  `ADMIN_INITIAL_PASSWORD`, `S3_*`.

**Missing:** `WHATSAPP_API_VERSION` is *not* in `.env.example`, is
not read anywhere in code, and is not shown on the frontend settings
screen (`views.tsx` WhatsApp settings lists the five WhatsApp names
above plus `JWT_SECRET`, but not the API version). The later
implementation stage must add the *name* only (value: the verified
version in Section 6, configurable, never hardcoded in code) — that
edit is out of scope for this audit document.

`docker-compose.yml` does not pass any WhatsApp variable to the app
service, and `railway.json` is empty. Render deployment therefore
depends entirely on variables set in the Render dashboard; there is no
other place they can come from, which is the correct posture, but it
means a fresh Render deploy has no WhatsApp configuration at all until
someone sets it there by hand.

### 1.7 Supporting pieces that are real and must be kept

- Append-only audit log (`GET /api/audit` only; other methods → 404),
  including webhook and template-approval events — a sound base for
  the later requirement that every Meta send/receive be audited.
- Permission model: `whatsapp:view` / `whatsapp:edit` enforced by the
  backend on the status, templates, and template-update endpoints;
  `ops_supervisor`/`ops_employee`/`financial_coordinator`/`viewer`
  role defaults do **not** include the `whatsapp` section at all
  (only `owner` has it by default), so template approval is
  owner-only unless a per-user override grants it. That is a safe
  default; keep it.
- Kill Switch (`POST/GET /api/automation/kill-switch`): forces new
  automation rules inactive and blocks rule toggles while on. It does
  **not** currently stop anything Meta-related, because nothing
  Meta-related runs — the later stage must define what Kill Switch
  means for outbound sends (see `docs/meta-linking.md`).
- `docs/provider-dashboard-structure.md`: an honest design record of
  provider dashboards studied (WATI, respond.io, Interakt, 360dialog /
  get.chat, Twilio, Chatwoot) and of what was deliberately *not*
  copied (broadcasts, catalogs, in-chat payments, AI selling,
  Shopify). That "not copied" list is a standing rule, not a gap.
- `README.md` line ~118 states plainly that real WhatsApp
  send/receive "does not work before linking" and is built only after
  a Meta account, a dedicated number, and approved templates exist.
  That sentence is accurate and should stay.

---

## 2. What is missing (complete list — nothing here exists today)

1. **Outbound sending.** No `POST /{phone-number-id}/messages` call,
   no text send, no template send, no media send, no interactive
   buttons/lists send, no message-ID storage, no delivery/read
   tracking, no error mapping (e.g. outside-window, unregistered
   number, rate-limit errors).
2. **Inbound routing.** No parsing of Meta's `object` /
   `entry[]` / `changes[]` / `value` envelope; no handling of
   `messages`, `statuses`, or any other field; no sender → contract
   buyer/seller conversation matching; no unread-count bump for real
   inbound messages; no media download; no read-receipt marking.
3. **Deduplication and ordering.** No dedup on Meta message ID
   (`wamid`), no handling of batched entries, retries (Meta retries
   for up to 7 days), or out-of-order delivery/read events.
4. **Webhook subscription management.** No code or documented step
   subscribing the WABA to any field (see Section 6 for the field
   list). Subscribing is a manual Meta-dashboard action in the plan.
5. **Template lifecycle with Meta.** No create/submit, no list/sync
   from Meta, no approval/rejection reason capture, no edit-and-
   resubmit, no language-code handling (runtime uses `ar`; Meta
   template languages are locale codes — this must be resolved at
   submission time, not assumed), no parameter/component definition
   for any of the 10 templates (they currently have no body text at
   all, so they cannot be submitted as-is).
6. **24-hour customer-service window logic.** No record of any
   customer's last inbound timestamp, no check that a free-text reply
   is inside the window, no forced-template rule outside it, no
   opt-in record.
7. **Phone / WABA management.** No read of phone number status,
   quality rating, messaging limit tier, or display name from Meta;
   no number registration flow; no test-number handling.
8. **Token lifecycle.** No system-user token creation, expiry/refresh
   handling, or revocation handling in code; no token health check.
   (Token creation is a manual, client-owner action — see the plan.)
9. **Embedded Signup.** No Meta app, no Embedded Signup flow, no
   OAuth callback, no token exchange. Deliberate for now: see
   Section 6 — the plan uses manual setup in the client's own account.
10. **Connection wizard / real status page.** No in-app wizard, no
    step that verifies anything against Meta, no "last webhook event
    received at" timestamp, no disconnect action.
11. **Failure handling for Meta calls.** No retry/backoff, no
    queue, no dead-letter record, no alerting — because no Meta call
    exists yet. (Redis/BullMQ is mentioned in `README.md` for
    production queues but is not wired to anything WhatsApp.)
12. **Tests for any of the above.** `test.js` (55 checks per the
    brief) covers auth, permissions, contracts, templates-local,
    inbox-local, tasks, workflows-local, kill switch, and audit. It
    contains zero webhook tests, zero send tests, and it explicitly
    deletes `WHATSAPP_APP_SECRET` from the environment before
    starting the server, so even the existing HMAC branch is never
    exercised by the suite.

---

## 3. Defects in the existing webhook handler (fix before real traffic)

These are in `backend/src/server.js`, webhook POST block:

1. **Signature computed over re-serialized JSON, not the raw body.**
   The handler parses the body first (`readBody` → `JSON.parse`),
   then computes `HMAC(JSON.stringify(body))`. Meta signs the exact
   raw bytes it sent. Re-serialization changes key order, spacing,
   and non-ASCII escaping, so a genuine Meta signature will
   *usually not match* and real webhooks will be rejected with 401 —
   or, worse, the check becomes unreliable rather than trustworthy.
   Fix (later stage): capture the raw request bytes before parsing
   and HMAC those. This is the single most important webhook fix.
2. **Missing signature bypasses the check.** The guard is
   `if (WHATSAPP_APP_SECRET && sig) { …reject on mismatch… }`. If the
   secret is set but a request arrives *without* the header, the
   guard is skipped and the payload is accepted and stored. Fix:
   when a secret is configured, a missing or malformed signature
   must be rejected; when no secret is configured, the endpoint
   must refuse Meta traffic explicitly rather than accept it
   unsigned (or at minimum log loudly and never treat it as a real
   customer message).
3. **Non-constant-time comparison.** The check uses `!==` on strings;
   the login-token code in the same file correctly uses
   `crypto.timingSafeEqual`. Use the same for the webhook.
4. **Payload size vs Meta.** `MAX_BODY_BYTES` is 1 MB; Meta webhook
   payloads can be up to ~3 MB (batched entries, media metadata).
   A legitimate batched payload over 1 MB is currently rejected
   with 413 before it is ever verified.
5. **Silent acceptance of garbage.** If the body is not valid JSON,
   `readBody` resolves to `{}` and the handler stores
   `body: "{}"` as an "inbound message" with 200. Invalid payloads
   must be rejected, not stored as messages.
6. **No envelope validation.** The handler never checks
   `object === 'whatsapp_business_account'`, never iterates
   `entry[]/changes[]`, and stores `JSON.stringify(body).slice(0,
   500)` — truncation that destroys the payload it claims to have
   received. A stored webhook row today is evidence of nothing.
7. **No fast acknowledgement discipline.** The handler writes to the
   JSON file store and audits synchronously before responding. That
   is tolerable for one fake payload and wrong for real traffic:
   Meta expects a fast 200 and retries otherwise. Later stages must
   acknowledge fast and process after (or prove the store write is
   fast enough under real load).

---

## 4. What is misleading or strange (wording/state that over-claims)

| # | Location | Claim / behaviour | Reality |
|---|----------|-------------------|---------|
| M1 | `GET /api/whatsapp/status` → `health: true` | "Healthy" | Hardcoded. True even with zero WhatsApp variables set, no token, no webhook ever received. Must become a computed value (or be removed) in the later stage. |
| M2 | `frontend/src/views.tsx` Inbox: "تم إرسال الرد." | Reply sent | Row saved locally only. Nothing leaves the server. Until real sending exists, the copy must say "saved locally — not sent to WhatsApp" or the button must be labelled a draft/note. |
| M3 | `frontend/src/views.tsx` Templates subtitle: "حالة الاعتماد هنا تعكس حالة Meta كما يحدّثها المشرف" | Status mirrors Meta | It mirrors whatever a `whatsapp:edit` user typed. There is no Meta read. One click can mark all 10 "approved" while Meta has approved none — and `test.js` does exactly that for template 1. The later stage must either sync status from Meta or label the field "manual mirror, unverified". |
| M4 | Dashboard stat "قوالب معتمدة X / 10" (`views.tsx`) | Approved templates | Same local count as M3. Do not use it as a go-live gate until it is Meta-synced. |
| M5 | `GET /api/connection-checklist` always `pending` | Checklist | Correct in the sense that nothing is connected, but useless as progress tracking: completing a real step never flips it. The frontend localStorage checklist (M6) has the opposite flaw. |
| M6 | `Checklist()` in `views.tsx` (browser localStorage) | "مكتمل: N من 10" | Per-browser, per-device, tickable by anyone with a login, with no server verification. Two operators will see different progress. The plan replaces both checklists with one server-computed status page. |
| M7 | `frontend/src/views.tsx` Webhook tab: "التحقق بتوقيع HMAC مفعّل: نعم" | HMAC active | Means only "the env var is non-empty". Given defects 3.1–3.2, the check itself is not trustworthy yet. |
| M8 | `README.md` structure list: "Webhook واتساب" under `backend/` | Implies a working webhook | Only the handshake-shaped GET and the defective POST shell exist. The README's own "what does not work before linking" note (Section 1.7) is the accurate statement; the structure list should not be read as more than that. |
| M9 | `frontend/src/types.ts` `STEP_TYPES` (buttons, lists, media, questions, conditions, delays…) + `workflow.tsx` media/caption fields | A flow builder that can send rich WhatsApp content | No execution engine exists, and no WhatsApp send exists. Designing a flow that "sends a list" today designs a form that does nothing. The later stage must either implement execution or hide unimplemented step types. |
| M10 | `backend/README.md` line ~67: "POST checks HMAC-SHA256 when WHATSAPP_APP_SECRET is set" | Accurate but incomplete | It omits the missing-signature bypass (3.2) and the re-serialization defect (3.1). Anyone reading only the README will believe the webhook is verified. |

---

## 5. What is unnecessary, duplicated, or drifting (do not build on it)

- **Schema ↔ runtime drift** (`db/schema.sql` vs `server.js`):
  `conversations.status` allows `new/open/waiting/closed` in SQL but
  the runtime uses `new/open/pending/resolved/closed`;
  `messages.body` is `NOT NULL` in SQL but webhook rows and template
  rows carry truncated JSON or null bodies; `whatsapp_templates.body`
  is `NOT NULL` in SQL but runtime templates have no body;
  `contract_files.file_url` is `NOT NULL` in SQL but the runtime
  stores `filename` only; `audit_log.actor_id` is a user FK in SQL
  but the runtime audits by email string (`actor`). The Postgres
  migration in the later stage must reconcile these instead of
  assuming the schema already matches the API. (The runtime
  currently persists to `backend/src/data.json`, not Postgres, so
  this drift is latent — it becomes a real failure the day Postgres
  is switched on.)
- **Two checklists** (server `CHECKLIST_STEPS` vs frontend
  `CHECKLIST` in `types.ts`): same idea, different wording, different
  storage, neither verified. Keep one, server-computed, in the later
  stage; delete the other.
- **`railway.json`** only declares the Railway Dockerfile builder
  (1 replica, restart on failure) and `docker-compose.yml` carries
  no WhatsApp variables: neither file configures anything Meta-
  related, and neither should be cited as "Meta deployment
  configuration".
- **Nothing Meta-related is unnecessary in the sense of "delete
  it".** The webhook shell, status booleans, template list, and
  checklist are the right *skeleton*; they are incomplete and
  partly mislabelled, not surplus. What must *not* be added is the
  provider-dashboard exclusion list (Section 1.7): broadcasts /
  marketing templates, catalogs, in-chat payments, AI selling,
  Shopify/order automation. Those are out of scope by rule, not by
  omission.

---

## 6. Research findings (what the later implementation must follow)

Sources are cited in full at the end. Key points, with the
confidence note where secondary sources disagree:

### 6.1 Graph API version — VERIFIED from Meta

- **Current version to use by default: `v26.0`, released 29 July
  2026**, verified in Meta's own post *"Introducing Graph API v26.0
  and Marketing API v26.0"*
  (https://developers.facebook.com/blog/post/2026/07/29/introducing-graph-api-v26-and-marketing-api-v26/),
  page crawled 2026-10-29. The same post records Graph API v20.0
  removed 24 September 2026 and v21.0 removal on 21 January 2027.
- The version must still be a **configurable env var**
  (`WHATSAPP_API_VERSION`, default `v26.0`), pinned in every request
  path (`https://graph.facebook.com/{version}/{phone-number-id}/messages`),
  and re-checked against Meta's changelog at implementation time —
  versions retire, and a pinned version is not a permanent fact.
  Older tutorials citing v19–v22 are stale and must not be copied.
- The v26.0 post is a general Graph/Marketing API announcement, not
  a WhatsApp-specific changelog; the WhatsApp endpoint surface
  (send, templates, webhooks) follows the same versioning, but the
  implementation stage must confirm the WhatsApp reference for the
  pinned version before going live.

### 6.2 Accounts, verification, numbers (manual setup — the chosen path)

- **Manual setup in the client's own account is the plan** (see
  `docs/meta-linking.md`): create/select a Meta Business portfolio
  (business.facebook.com), create a Meta developer app with the
  WhatsApp use case, create/select a WABA, register a **dedicated**
  number, verify it by SMS/voice OTP, set an approved display name.
  This mirrors Chatwoot's documented manual setup (Chatwoot user
  guide, "Connect with WhatsApp Cloud API (manual setup)"), which
  asks for exactly three things: a Meta app, the Phone Number ID +
  WABA ID, and a permanent system-user token.
- **Embedded Signup is deliberately NOT the plan for this pilot.**
  It is Meta's hosted wizard for onboarding *other* businesses
  through a provider/Tech Partner app; it needs a provider app and
  App Review for that use case. This pilot has one client, one
  number, and no provider app, so manual setup is simpler, keeps
  every asset in the client's name, and matches the "no BSP"
  rule. Embedded Signup can be revisited only if a future multi-
  client product needs it.
- **Dedicated number (hard rule).** A Cloud API number cannot also
  be an ordinary WhatsApp app number in this manual setup. A number
  already in the WhatsApp / WhatsApp Business app must be deleted
  from that app first (or a different number used). Chatwoot's
  manual-setup guide states the same restriction explicitly
  ("Coexistence … is not supported with manual setup").
- **Business verification is not a gate for first messages, but it
  raises limits.** Multiple secondary sources agree: an unverified
  business can message, but business-initiated conversations are
  capped low; verification (legal document matching the legal name,
  via Business Settings → Security Center) raises the tier.
  **Messaging limits are portfolio-level since 7 October 2025**
  (WATI prerequisites article) — the older per-number 1,000 /
  10,000 tiers are gone. Reported starting points differ across
  sources (250 business-initiated conversations per rolling 24h
  for unverified accounts is the most commonly cited figure;
  WATI cites 2,000 conversations for a verified business with an
  approved display name). **Do not hardcode any tier into the
  product:** read the tier shown in WhatsApp Manager at setup and
  record it in the go-live checklist. Quality rating and policy
  compliance affect whether the tier rises or is restricted.
- **Test number first.** Meta's API Setup provides a test number
  and a `hello_world` template for development, limited to a small
  set of test recipients. Use it for the first webhook/send tests;
  never test against real customers.

### 6.3 Tokens

- **Production token = system user token, permanent ("Never"
  expiry), with `whatsapp_business_messaging` and
  `whatsapp_business_management`.** Created in Business Settings →
  Users → System Users: create an admin system user, assign it the
  Meta app and the WABA with full control, generate the token with
  those two permissions. Meta shows it only once; it lives only in
  the hosting environment (Render env vars), never in a file, chat,
  or frontend screen.
- **Temporary/test tokens expire (24 hours)** and are for the API
  Setup test only. **Embedded-Signup user tokens last ~60 days**
  and need a reconnection flow — another reason manual system-user
  tokens are the right choice here: no silent expiry, but revocation
  by the owner still breaks sending, so the status page must detect
  auth failures and say "token revoked/expired — owner must
  regenerate" rather than failing silently.
- Never use a personal user token for production traffic.

### 6.4 Webhook fields to subscribe (Meta dashboard, app → WhatsApp → Configuration)

Subscribe, at minimum: `messages` (inbound messages, media,
interactive replies), `message_status` — reported in some sources
as `message_status` / in the WABA field list as delivery status
(sent, delivered, read, failed) — and
`message_template_status_update` (template approved / rejected /
paused / disabled, with reasons). Also subscribe
`phone_number_quality_update`, `phone_number_name_update`,
`account_update`, and `business_capability_update` where the
dashboard offers them, so number-quality and capability changes
are visible instead of discovered by failed sends. Field names
vary slightly between the app-level and WABA-level subscription
screens; the implementation stage must confirm the exact list
shown in the client's dashboard at setup time and record it in
the status page, not guess.
- Callback URL is the live Render domain plus the existing path
  (see the plan). It must be HTTPS — Render provides that.
- Verification handshake: GET with `hub.mode=subscribe`,
  `hub.verify_token` (must equal `WHATSAPP_VERIFY_TOKEN`), echo
  `hub.challenge` as plain text with 200. POSTs carry
  `X-Hub-Signature-256: sha256=<HMAC-SHA256 of the RAW body with
  the app secret>`. Verify over raw bytes, constant-time, before
  parsing; acknowledge 200 fast; process after. Meta retries failed
  deliveries with backoff for up to 7 days; delivery is at-least-
  once, ordering is not guaranteed — hence dedup on `wamid` and
  status ranking (never let an old `delivered` overwrite a newer
  `read`, but always apply `failed`).

### 6.5 Sending, the 24-hour window, and templates

- Send endpoint shape (all message types share it):
  `POST https://graph.facebook.com/{version}/{phone-number-id}/messages`
  with `Authorization: Bearer <system-user token>`,
  `messaging_product: "whatsapp"`, `to` (international format,
  no `+`, no spaces), and `type: "text" | "template" | …`.
  Success returns a `wamid` message ID; statuses for that ID arrive
  later on the webhook. Error examples reported: `131047` (number
  not registered), `131026` (outside the 24-hour window).
- **24-hour customer-service window:** opens on each customer
  message; inside it, free-form text/media/interactive replies are
  allowed. Outside it — or to start a conversation — **only an
  approved template** may be sent, and only to a customer who has
  opted in. A template send opens a new 24-hour window. For this
  pilot (closed, invite-only), the opt-in is the invitation/contract
  relationship itself; cold outreach is out of scope and must stay
  out.
- **Template categories: Marketing, Utility, Authentication.**
  This service uses **Utility only**, deliberately: transactional
  notices tied to a contract the customer already entered
  (created, accepted, payment requested, payment confirmed by the
  FI, preparing, delivered, closed, dispute opened, handover).
  Marketing (promotions, re-engagement) and Authentication (OTPs)
  are excluded by rule. Meta may reclassify a Utility template as
  Marketing if the wording is promotional or conversational, which
  changes its price — so Utility copy must read as a direct
  notification, not an invitation to chat or buy.
- **Approval:** every template is reviewed by Meta; plan for a
  decision within **24 hours** (utility templates are often faster;
  some provider reports say minutes to a few hours — do not promise
  that). Rejection reasons fall in three families: format
  (variables `{{n}}` misplaced, non-sequential, duplicated, or at
  the very start/end; bad sample values; naming), category
  mismatch (promotional wording filed as Utility), and policy
  (sensitive data requests, prohibited links such as URL
  shorteners or `wa.me` links, commerce-policy breaches).
  Rejected templates are fixed by editing the wording and
  resubmitting (or appealing if genuinely compliant) — never by
  marking them "approved" locally. Approved templates can later be
  **paused** (reported pattern: 3 hours, then 6 hours) and
  **disabled** on repeated quality problems; the
  `message_template_status_update` webhook is how the system learns
  this, and the status page must show it.
- **Template limits reported:** 250 templates per messaging account,
  rising to 6,000 once the business is verified with an approved
  display name. The pilot needs 10; the limit is not a constraint.
- **Pricing note (owner decision, not a product feature):** since
  July 2025 Meta bills per template message delivered, by category
  (Marketing highest, Utility mid, Authentication lowest; service
  replies inside the window are free). The owner pays Meta directly
  under the client's own portfolio (payment method on the
  portfolio). No BSP fee exists in this direct route. Exact rates
  are country-dependent — read them in WhatsApp Manager; do not
  quote a rate in the product.

### 6.6 GitHub / open-source projects studied

| Project / source | Mechanism | Copy for Pilot System | Reject, and why |
|---|---|---|---|
| **Chatwoot** (open source, self-hosted team inbox; user guide "Connect with WhatsApp Cloud API (manual setup)", https://www.chatwoot.com/hc/user-guide/articles/1756799850-how-to-setup-a-whats_app-channel-manual-flow) | Native WhatsApp Cloud inbox: Meta app + Phone Number ID + WABA ID + permanent system-user token; webhook URL + verify token generated by the inbox; signature checked against the inbox app secret; shared inbox with assignment, internal notes, statuses, templates | The manual-setup trio (app + IDs + permanent token), the "verify details" step before creating the channel, and the inbox pattern Pilot already has (assignment, internal notes, statuses). The wizard in the plan is modelled on this flow, minus Chatwoot itself | Chatwoot as a second system (it would duplicate Pilot's per-contract inbox); Twilio and 360dialog provider options (Chatwoot lists them; Pilot uses direct Cloud API, no BSP); campaigns (Chatwoot Cloud feature — broadcasts, excluded by rule) |
| **WhatsApp-Nodejs-SDK** (Meta's official Node SDK, now deprecated; types referenced at https://github.com/WhatsApp/WhatsApp-Nodejs-SDK/blob/main/src/types/webhooks.ts) | Typed webhook envelope (`entry/changes/value`), typed send calls | The webhook type shape as a reference for parsing (iterate all entries/changes, never just index 0) | The SDK itself (deprecated; Pilot's backend uses Node built-ins only, no new dependencies — implement the two calls with `fetch`/`https` instead) |
| **great-detail/WhatsApp-JS-SDK** (unofficial fork of the deprecated official SDK; README via search result) | Client wrapping messages, media, phone/WABA management, templates, webhook subscription | The endpoint inventory as a checklist (send, media get/upload, template list/create, phone read) | Adopting an unofficial SDK dependency (unnecessary surface; the pilot needs ~4 endpoints, not a full SDK) |
| **business-whatsapp-api** (TypeScript SDK; README via search result) | Builder pattern for text/image/template messages; `onMessage` / `onMessageStatus` webhook handlers | The handler split — one handler for inbound messages, one for statuses — as the code structure to copy | The SDK dependency itself, for the same reason as above |
| **meta-cloud-api** (community SDK; `website/src/content/docs/api/direct-send.mdx`, https://github.com/froggy1014/meta-cloud-api/blob/09a85ccfb498870d8616391017a6c11af9278453/website/src/content/docs/api/direct-send.mdx) | Direct Send: free-form reply auto-matched to a Utility template | Nothing, except the warning it documents: reusing a manually created template name returns error `132021` | **Direct Send itself** — it lets a team write free-form replies outside the window by auto-matching a template in the background. That bypasses the pilot's explicit template discipline and its audit story (which template was actually sent). Pilot sends must name the template explicitly. |
| **Node webhook guides** (dev.to: "Handling WhatsApp Cloud API Webhooks in Node.js", https://dev.to/wapgrowai_org/handling-whatsapp-cloud-api-webhooks-in-nodejs-signatures-retries-and-duplicate-events-4dci; "Building a Production WhatsApp Cloud API Webhook in Node.js & Express", https://dev.to/aisoule/building-a-production-whatsapp-cloud-api-webhook-in-nodejs-express-3jbh) | Raw-body HMAC, dedup by `wamid`, fast 200 + async processing, status ranking, full-entry iteration | All of it — this is the fix list for Section 3, in the later stage | Their "bot auto-reply" examples (auto-replies to every inbound message). Pilot replies are human operator actions or explicitly approved workflow steps, never an always-on bot. |
| **Provider wizards** (Wazzup, Yellow.ai, 8x8 Connect, Sent — Embedded Signup walkthroughs) | Meta-hosted Embedded Signup window → select/create portfolio, WABA, profile, verify number → return to provider dashboard with channel "Active" (often ~10 minutes after completion) | The *shape* of a good wizard: one linear flow, one screen per decision, a visible "Active" state only after verification, and a test message as the last step | Embedded Signup itself for this pilot (Section 6.2); any provider's hosted channel (a BSP would sit between the client and Meta, against the no-BSP rule); trial/balance top-ups and campaign features shown in those wizards |

---

## 7. What the later stages must do (pointer only — plan is in `docs/meta-linking.md`)

1. Fix the webhook handler per Section 3 (raw-body HMAC, reject
   missing signatures, constant-time compare, 3 MB allowance,
   envelope validation, dedup, fast 200).
2. Implement outbound send (text inside window, template outside
   window) with `wamid` storage, status updates, and audit rows.
3. Implement inbound routing to buyer/seller conversations, unread
   counts, media handling, and window tracking.
4. Implement Meta template sync (list from Meta, submit, capture
   rejection reasons, edit/resubmit) and replace the local-only
   approval flag with Meta-synced status — or relabel it honestly.
5. Replace both checklists and the boolean status page with one
   server-computed connection status (see the plan's wizard spec).
6. Add webhook/send tests to `test.js` (including the HMAC branch
   with a secret set, a bad-signature case, a missing-signature
   case, a duplicate-`wamid` case, and an outside-window send
   rejection). The current suite must not be weakened to pass.
7. Reconcile `db/schema.sql` with the runtime before any Postgres
   switch-on (Section 5 drift list).
8. Keep every hard rule intact: no wallets/balances, no
   marketplace/catalog, no bank API, no payment confirmation
   without an FI reference, no money step in any workflow, audit
   append-only, WhatsApp-only customer interface, client-name
   accounts, dedicated number, no BSP.

---

## Sources

Meta (official):
- Meta Developers Blog — "Introducing Graph API v26.0 and Marketing
  API v26.0" (29 July 2026) —
  https://developers.facebook.com/blog/post/2026/07/29/introducing-graph-api-v26-and-marketing-api-v26/
  (version v26.0 verified here; retirement dates for v20.0/v21.0
  from the same post)
- Meta WhatsApp Cloud API documentation, referenced as
  https://developers.facebook.com/docs/whatsapp/cloud-api
  (endpoint surface: send, templates, webhooks, media; cited via
  the texhub SDK reference to the same URL)
- Meta Business / developer consoles named in the sources:
  https://business.facebook.com/ and https://developers.facebook.com/

Secondary / provider sources (used only where noted, and flagged as
such in the text):
- Chatwoot user guide — "Connect with WhatsApp Cloud API (manual
  setup)" —
  https://www.chatwoot.com/hc/user-guide/articles/1756799850-how-to-setup-a-whats_app-channel-manual-flow
- WATI — "WhatsApp API Prerequisites: Phone, Documents, and
  Verification" — https://www.wati.io/en/blog/whatsapp-api-prerequisites/
  (portfolio-level limits since 7 Oct 2025; 2,000-conversation
  figure for verified businesses)
- Hookdeck — "Guide to WhatsApp Webhooks: Features and Best
  Practices" —
  https://hookdeck.com/webhooks/platforms/guide-to-whatsapp-webhooks-features-and-best-practices
  (field list, retry up to 7 days, at-least-once, no ordering)
- Irurueta docs — "WhatsApp Business" —
  https://www.irurueta.com/ai/conversational-channels/whatsapp-business.html
  (raw-body HMAC warning; dedup on `wamid`)
- The Automate AI — "WhatsApp Template Message Examples & Approval
  Rules (2026)" — https://theautomate.ai/blog/whatsapp-template-messages/
  (24-hour review, 250 / 6,000 template limits, pause/disable pattern)
- Aloha help — "Best practices for creating WhatsApp templates" —
  https://help.aloha.co/en/article/best-practices-for-creating-whatsapp-templates-1xds6g/
  (Utility reclassification risk since April 2025)
- Manifest blog — "WhatsApp Template Rejected? Categories and
  Approval Tips 2026" —
  https://blog.getmanifest.ai/whatsapp-template-rejections-categories/
  (three rejection families)
- Dev.to (Node webhook guides) —
  https://dev.to/wapgrowai_org/handling-whatsapp-cloud-api-webhooks-in-nodejs-signatures-retries-and-duplicate-events-4dci
  and
  https://dev.to/aisoule/building-a-production-whatsapp-cloud-api-webhook-in-nodejs-express-3jbh
  (raw-body, dedup, status ranking, full-entry iteration; send
  endpoint shape)
- Provider wizard walkthroughs: Wazzup —
  https://wazzup24.com/help/how-to-set-up/how-to-connect-the-official-whatsapp-waba/;
  Yellow.ai —
  https://docs.yellow.ai/docs/platform_concepts/channelConfiguration/whatsapp-configuration;
  8x8 Connect — https://developer.8x8.com/connect/docs/whatsapp/getting-started/
  (Embedded Signup flow shape; "Active" only after verification)
- GitHub projects: Chatwoot manual-setup guide (above); Meta
  WhatsApp Node SDK types —
  https://github.com/WhatsApp/WhatsApp-Nodejs-SDK/blob/main/src/types/webhooks.ts;
  meta-cloud-api Direct Send docs —
  https://github.com/froggy1014/meta-cloud-api/blob/09a85ccfb498870d8616391017a6c11af9278453/website/src/content/docs/api/direct-send.mdx
  (Direct Send rejected — see Section 6.6)

*Note on source quality:* where Meta's own docs could not be
opened in full during this research (no live browser in this
stage), the audit says so by attributing the point to the
secondary source that states it, and the plan tells the
implementation stage to re-confirm field names, tiers, and prices
in the client's own Meta dashboard at setup time. Nothing in this
audit is presented as verified from Meta unless it cites the Meta
blog post above.
