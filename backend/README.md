# Pilot System — Backend (Node.js built-ins only)

Run: `node src/server.js` (default port 3000) · Test: `node src/test.js` (runs twice per project rule).
No external dependencies. Data persists to `src/data.json` (gitignored) for local testing; production uses the same API shape on PostgreSQL via `db/schema.sql`.

## Hard rules (never bypassed)

- No internal wallet/balance, no marketplace, no automated bank API.
- `payment_confirmed` requires `financial_reference` from the external financial institution.
- Money steps are never allowed in workflows or automation rules: `release_money`, `refund_money`, `confirm_payment`, `settle_dispute` → 400.
- Audit log is append-only: `GET /api/audit` only. POST/PUT/PATCH/DELETE on it return 404. Every successful mutation below appends an audit entry.
- WhatsApp webhook: `GET /api/whatsapp/webhook` verifies `hub.verify_token` against `WHATSAPP_VERIFY_TOKEN`; `POST` checks HMAC-SHA256 (`x-hub-signature-256`) when `WHATSAPP_APP_SECRET` is set. Secrets are never stored in files.
- Contract files store **metadata only** (`filename`, `kind`, `mime_type`, `size_bytes`) — any content/bytes fields in a request are dropped.

## Endpoints

### Users (5 roles only: owner, ops_supervisor, ops_employee, financial_coordinator, viewer)

- `GET /api/users`, `GET /api/users/:id`, `POST /api/users` (invalid role → 400)
- `PUT /api/users/:id` (role / is_active / name / email)
- `POST /api/users/:id/disable`, `POST /api/users/:id/enable`
- `DELETE /api/users/:id`
- Owner guard: disabling or deleting the only active owner → 400 (`cannot disable/delete the only active owner`).

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
- `PUT /api/templates/:id` — only `approval_status` changes, and only to `pending` / `approved` / `rejected` (other values → 400; other fields are ignored)

### Automation rules & Kill Switch

- `GET /api/automation/rules`, `GET /api/automation/rules/:id`, `POST /api/automation/rules`
- `POST /api/automation/rules/:id/toggle`
- `GET /api/automation/kill-switch`, `POST /api/automation/kill-switch` (`{ off: true/false }`, kept as-is)
- When the Kill Switch is on, rule creation is still allowed but the rule is forced `is_active: false` (`deactivated_by_kill_switch: true`); toggling to active is likewise blocked while it is on. No money action exists or executes.

### Connection checklist

- `GET /api/connection-checklist` — array of exactly 10 steps, Arabic titles: Meta Business, dedicated number, FI agreement, templates approval, env vars, webhook HMAC, test message, full cycle test, backup/monitoring, client acceptance.
