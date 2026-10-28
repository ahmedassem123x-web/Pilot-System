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
- WhatsApp webhook: `GET /api/whatsapp/webhook` verifies `hub.verify_token` against `WHATSAPP_VERIFY_TOKEN`; `POST` checks HMAC-SHA256 (`x-hub-signature-256`) when `WHATSAPP_APP_SECRET` is set. Secrets are never stored in files.
- Contract files store **metadata only** (`filename`, `kind`, `mime_type`, `size_bytes`) — any content/bytes fields in a request are dropped.

## Endpoints

### Auth

- `POST /api/auth/login` (`{ email, password }` → `{ token, user }`, never a password hash; generic error on any failure)
- `GET /api/auth/me` (Bearer token → current user with effective sections/actions)
- `POST /api/auth/change-password` (`{ current_password, new_password }`, ≥ 8 chars)
- `GET /api/departments` (4 departments, any authenticated user)
- `GET /api/whatsapp/status` (`whatsapp:view`; booleans only — verify token set, HMAC enabled, access token set, template counts — no secret values)

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
