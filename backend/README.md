# Pilot System — Backend (Node.js built-ins only)

Run: `node src/server.js` (default port 3000) · Test: `node src/test.js` (runs twice per project rule).
No external dependencies. Data persists to `src/data.json` (gitignored) for local testing; production uses the same API shape on PostgreSQL via `db/schema.sql`.

## Security + auth (2026-10-28 upgrade)

- **Auth on all `/api` routes** except `/health`, `POST /api/auth/login`,
  and `GET`/`POST /api/whatsapp/webhook`. Missing/invalid/expired token or
  a disabled account → 401. Tokens are HMAC-signed with `JWT_SECRET`
  (8h expiry); with no `JWT_SECRET` the server uses a random per-process
  secret and logs a warning — never a hardcoded default.
- **Login rate limiting**: max 10 failed attempts per IP per 15 minutes
  (then 429); **one generic login error** (`invalid email or password`)
  for unknown user, wrong password, disabled account, and missing fields.
- **Request-body limit**: 1 MB, larger → 413.
- **Security headers on all responses**: Content-Security-Policy
  (with `unsafe-inline` only because the frontend is a single inlined HTML
  file), X-Content-Type-Options: nosniff, X-Frame-Options: DENY,
  Referrer-Policy: no-referrer, Cache-Control: no-store on `/api`.
- **Input validation**: emails are trimmed + lowercased and shape-checked;
  passwords must be non-empty and ≥ 8 chars on creation/reset/change;
  role/department/section/action values are checked against allowlists;
  user endpoints reject unknown fields with 400.
- **Passwords**: scrypt only, per-user salt, format
  `scrypt:<salt>:<hash>`; hashes are never returned by any endpoint.
- **Primary admin**: on first start only, if `db.users` is empty AND both
  `ADMIN_EMAIL` and `ADMIN_INITIAL_PASSWORD` are set in the environment,
  an owner with department `Administration`, all sections, all actions,
  `is_primary_admin=true` is created and audited. No credential is ever
  hardcoded or written to a file. If the env vars are missing at first
  start and no user exists, nobody can log in — restart with them set
  before any user is created.
- **Permissions are enforced by the backend on every endpoint** (section +
  action mapping; see below), not just hidden in the UI. A forbidden
  section returns 403. Audit covers login success/failure, user creation,
  password change/reset, permission changes, and disable/enable.
- **Permission model**: sections `dashboard, contracts, inbox, tasks,
  whatsapp, automation, users, audit, settings`; actions per section
  `view/create/edit/approve` plus `users:manage`. Role defaults: owner =
  all; ops_supervisor = dashboard, contracts, inbox, tasks, automation,
  audit (view/create/edit, approve contracts/tasks); ops_employee =
  dashboard, contracts, inbox, tasks (view/create/edit, no approve);
  financial_coordinator = dashboard, contracts (view), inbox (view),
  tasks (view), audit (view) — financial confirmation itself stays a human
  action with an FI reference, never automated; viewer = dashboard,
  contracts, inbox, audit (view only). Departments: Operations, Finance
  Coordination, Customer Support, Administration (`GET /api/departments`).
  Per-user `sections`/`actions` stored on the user record override/restrict
  the role defaults; changing role without explicit overrides resets to
  the new role's defaults. Primary admin cannot be disabled or deleted;
  the only active owner cannot be disabled or deleted.
- **Route permission mapping (examples)**: `POST /api/contracts` needs
  `contracts:create`; transition to `payment_confirmed` needs
  `contracts:approve`, other transitions need `contracts:edit` or
  `contracts:approve`; users endpoints need `users:manage`; template
  approval needs `whatsapp:edit`; kill-switch needs `automation:edit`;
  tasks complete/cancel need `tasks:edit` or `tasks:approve`; checklist
  and departments are available to any authenticated user.

## Hard rules (never bypassed)

- No internal wallet/balance, no marketplace, no automated bank API.
- `payment_confirmed` requires `financial_reference` from the external financial institution.
- Money steps are never allowed in workflows or automation rules: `release_money`, `refund_money`, `confirm_payment`, `settle_dispute` → 400.
- Audit log is append-only: `GET /api/audit` only. POST/PUT/PATCH/DELETE on it return 404. Every successful mutation below appends an audit entry.
- WhatsApp webhook: `GET /api/whatsapp/webhook` verifies `hub.verify_token` against `WHATSAPP_VERIFY_TOKEN`; `POST` verifies HMAC-SHA256 (`x-hub-signature-256`) over the RAW request body with `WHATSAPP_APP_SECRET`, using a constant-time comparison. A missing or malformed signature is rejected (401); when no app secret is configured, webhook traffic is refused outright (401) rather than accepted unsigned. Invalid JSON (400) and invalid envelopes (400) are never stored as messages. Webhook bodies allow up to 5 MB; all other routes keep the 1 MB limit. Secrets are never stored in files.
- Contract files store **metadata only** (`filename`, `kind`, `mime_type`, `size_bytes`) — any content/bytes fields in a request are dropped.

## Endpoints

### Auth

- `POST /api/auth/login` (`{ email, password }` → `{ token, user }`, never a password hash; generic error on any failure)
- `GET /api/auth/me` (Bearer token → current user with effective sections/actions)
- `POST /api/auth/change-password` (`{ current_password, new_password }`, ≥ 8 chars)
- `GET /api/departments` (4 departments, any authenticated user)
- `GET /api/whatsapp/status` (`whatsapp:view`; booleans only — verify token set, HMAC enabled, access token set, phone-number ID set, WABA ID set, `meta_configured`, `api_version` (env value or `v26.0`), local + Meta template counts, and a 7-step `wizard_steps` array `{ key, title_ar, status: done|pending|blocked }` — no secret values). Note: `health` is now computed as `meta_configured`, not hardcoded `true`.
- `POST /api/whatsapp/test-token` (`whatsapp:edit`; admin-grade) — checks the Meta connection via `GET /me` on Graph API (`WHATSAPP_API_VERSION`, default `v26.0`). Returns `{ ok, configured, meta_ok, dry_run, error?, meta_error_code? }`, never a token value or prefix. When unconfigured it returns `configured: false, meta_ok: false, dry_run: true` and does NOT call Meta.
- `POST /api/whatsapp/send` (`whatsapp:edit`; body `{ to, body?, template_name?, language?, parameters?, media?, buttons?, list?, type? }`) — rejected while the Kill Switch is on. Free text / media / buttons (max 3) / list (max 10 rows) require an open 24-hour window (an inbound message from that phone within 24h, tracked as `last_inbound_at` per conversation); otherwise 400 `outside_24h_window_use_template`. Template sends require the template to exist locally and be locally approved; when Meta is configured its Meta name is used. When Meta is unconfigured: `dry_run: true`, no Meta call, but the outbound message IS recorded locally marked `dry_run: true` and audited as a dry run — it is never claimed as sent. When configured: `POST /{phone-number-id}/messages`, the returned `wamid` is stored with `meta_status: sent` and audited; on a Meta error the sanitised Meta code/message is returned (502) and no fake success is recorded.
- `POST /api/whatsapp/templates` (`whatsapp:edit`) — creates a LOCAL template draft: `name` (lowercase/digits/underscores), `category` must be `UTILITY` (Marketing rejected), `language: ar`, `body` (with `{{1}}` placeholders), optional `buttons`. Sets `meta_status: 'not_submitted'`, `approval_status: 'pending'`.
- `POST /api/whatsapp/templates/:id/submit` (`whatsapp:edit`) — when unconfigured: `dry_run: true`, `meta_status` stays `not_submitted`. When configured: `POST /{waba-id}/message_templates`, `meta_status: 'pending'` on success (Meta `PENDING`), `meta_template_id` stored when returned, audited; on Meta error local state is kept and the sanitised error returned.
- `POST /api/whatsapp/templates/sync` (`whatsapp:edit`) — when unconfigured: `dry_run: true`. When configured: `GET /{waba-id}/message_templates`, updates local templates' `meta_status` (approved/pending/rejected/paused/disabled) matched by name; `approval_status` (local) is NEVER overwritten by Meta status. Returns both fields per template.
- `POST /api/whatsapp/webhook` (public, see security section) — parses the Meta envelope (`entry[].changes[].value`): inbound text and media messages (media bytes are never downloaded; only media type + caption are recorded) are routed to the matching contract buyer/seller conversation (phone normalised: spaces/dashes stripped, leading `+` kept) or to a GENERAL conversation (`contract_id: null`, `party: 'general'`) — a contract is NEVER created automatically. Inbound messages bump `unread_count`, update `last_inbound_at`, and are audited as `whatsapp_inbound`; duplicates are skipped by `wamid`. `statuses[]` update the outbound message's `meta_status` (sent/delivered/read/failed, with ranking so an older status never overwrites a newer one, except `failed` which always applies). `message_template_status_update` updates the matching template's `meta_status`. Other value types are ignored safely. A valid signature always gets 200, even if one change is malformed (it is skipped, not 500).

### Users (5 roles only: owner, ops_supervisor, ops_employee, financial_coordinator, viewer; all require `users:manage`)

- `GET /api/users`, `GET /api/users/:id` (password hashes never returned)
- `POST /api/users` (`full_name`, `email`, `password` ≥ 8 chars, `role`, `department`, optional `sections`/`actions` overrides; invalid role/department/section/action or duplicate email → 400; unknown fields → 400)
- `PUT /api/users/:id` (role / is_active / name / email / department / sections / actions; unknown fields → 400)
- `POST /api/users/:id/reset-password` (`{ password }`, ≥ 8 chars)
- `POST /api/users/:id/disable`, `POST /api/users/:id/enable`
- `DELETE /api/users/:id`
- Owner guard: disabling or deleting the only active owner → 400 (`cannot disable/delete the only active owner`); disabling or deleting the primary admin → 400.

### Contracts

- `GET /api/contracts`, `GET /api/contracts/:id`, `POST /api/contracts` (draft, version 1)
- `POST /api/contracts/:id/transition` (state machine; invalid transition → 400)
- `POST /api/contracts/:id/amend` — requires ≥1 amendable field; locks all previous versions, creates a new version with a fresh SHA-256 `clause_fingerprint`, updates the contract (`version`, `clause_fingerprint`). Old versions stay retrievable.
- `GET /api/contracts/:id/versions`
- `POST /api/contracts/:id/files` — `kind` must be `original` / `buyer_signed` / `seller_signed` / `attachment`, else 400
- `GET /api/contracts/:id/files` and `GET /api/contracts/:id/attachments` (same list)

### Inbox

- `GET /api/conversations?status=&assigned_to=&contract_id=&party=&unread=true`
- `GET /api/conversations/:id`, `PUT /api/conversations/:id` (status, assigned_to)
- `POST /api/conversations/:id/assign` (`assigned_to` required), `POST /api/conversations/:id/read` (resets unread_count)
- `POST /api/conversations/:id/reply` — free reply (`body`) or template reply (`template_name`); `is_internal_note: true` marks an internal note
- `GET /api/messages?conversation_id=&direction=&internal=false|true` — `internal=false` excludes internal notes
- `GET /api/customer/conversations/:id/messages` — customer view; internal notes are **never** returned here
- `GET /api/inbox/unread-counts` — `{ total_unread, by_status, conversations[] }`
- Inbound (`direction: in`, non-internal) messages increment the conversation's `unread_count`.

### Ops tasks

- `GET /api/tasks?status=&contract_id=&assigned_to=&type=`, `GET /api/tasks/:id`
- `POST /api/tasks` (`title` required), `POST /api/tasks/:id/complete` → `completed`, `POST /api/tasks/:id/cancel` → `cancelled` (terminal tasks cannot be reopened)

### Workflow designer

- `GET /api/workflows`, `GET /api/workflows/:id`, `POST /api/workflows`
- `PUT /api/workflows/:id` — steps are normalised and sorted by their `order` field (reorder = send new `order` values)
- `POST /api/workflows/:id/copy` — new id, name suffixed ` (نسخة)`
- `DELETE /api/workflows/:id`
- Any banned step type in create/edit → 400.

### Templates

- `GET /api/templates`, `GET /api/templates/:id` (10 seeded, Arabic labels via `label_ar`)
- `PUT /api/templates/:id` — only `approval_status` changes, and only to `pending` / `approved` / `rejected` (other values → 400; other fields are ignored); requires `whatsapp:edit`

### Automation rules & Kill Switch

- `GET /api/automation/rules`, `GET /api/automation/rules/:id`, `POST /api/automation/rules`
- `POST /api/automation/rules/:id/toggle`
- `GET /api/automation/kill-switch`, `POST /api/automation/kill-switch` (`{ off: true/false }`, kept as-is)
- When the Kill Switch is on, rule creation is still allowed but the rule is forced `is_active: false` (`deactivated_by_kill_switch: true`); toggling to active is likewise blocked while it is on. No money action exists or executes.

### Connection checklist

- `GET /api/connection-checklist` — array of exactly 10 steps, Arabic titles: Meta Business, dedicated number, FI agreement, templates approval, env vars, webhook HMAC, test message, full cycle test, backup/monitoring, client acceptance.

### Meta WhatsApp env vars & disconnect (names only — values live in hosting env, never in files)

- `WHATSAPP_API_VERSION` (default `v26.0`, Graph API version for every Meta request), `WHATSAPP_ACCESS_TOKEN` (system-user token, never returned or persisted), `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`. Test-only (never a production option): `META_MOCK_BASE_URL` points the Meta client at a local mock server and waives the real-token requirement; it must never be set in production.
- **24-hour rule**: free-form replies are allowed only within 24h of the customer's last inbound message (`last_inbound_at` per conversation); outside the window only an approved template may be sent.
- **Dry-run semantics**: when Meta is not fully configured (access token + phone-number ID + WABA ID), send/test-token/submit/sync return `dry_run: true`, make no Meta call, and — for sends — record the message locally marked `dry_run` so the UI must never render it as sent to WhatsApp.
- **Disconnect behaviour (by design)**: removing the WhatsApp env vars and redeploying disconnects Meta — `GET /api/whatsapp/status` then reports `meta_configured: false`, sends/test-token/submit/sync fall back to dry-run, and the webhook refuses traffic (401) until a valid app secret is configured again. Disconnecting does not delete local conversations, messages, templates, or audit rows.
