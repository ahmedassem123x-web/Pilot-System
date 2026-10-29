# ZeroMsg study — what was studied, what applies to Pilot System

**Source studied (2026-10-29, web/GitHub reading only — no code copied, no
PHP/Laravel introduced):**
- GitHub repository page: https://github.com/megoxv/zeromsg
  (public, MIT, default branch `main`, commit `ac876d4` at time of reading,
  3 commits, 21 stars). Root listing shows a Laravel 13 + Inertia React app:
  `app/`, `routes/`, `resources/`, `database/`, `config/`, `tests/`,
  `composer.json`, `package.json`, `vite.config.ts`.
- README sections read in full: Key Features, Screenshots, Requirements,
  Quick Install (incl. Demo Data), **WhatsApp Embedded Signup**, Manual
  Install, Contributing, License.
- Packagist mirror of the same README (same feature list, same env names)
  was used only to confirm the README text; it added nothing new.
- **Limit of this study:** the GitHub page render available to this worker
  exposed the README and the root file listing, not individual controller
  source files. Claims below about ZeroMsg internals are therefore limited
  to what the README states; where the README is silent, that is stated
  explicitly rather than inferred. No ZeroMsg code was run.

**What ZeroMsg is (README):** "a self-hosted WhatsApp Cloud API dashboard
for teams that want to connect their own Meta Business assets, manage
WhatsApp numbers, handle conversations, send campaigns, build automations,
and expose developer APIs from one clean, private workspace."
Stack: PHP 8.3+, Composer, Node.js, SQLite/MySQL/PostgreSQL, Meta developer
app credentials for Embedded Signup. Install: `composer create-project
megoxv/zeromsg`, auto-installer, optional demo workspace
(`composer run zeromsg:demo`).

## (a) Embedded Signup linking from inside the dashboard

README evidence:
- Feature bullet: "Meta Embedded Signup: Seamless onboarding of client
  numbers, WhatsApp Business Accounts (WABA), and system user access tokens
  using Meta's official signup flow."
- Section "WhatsApp Embedded Signup": configure in `.env`
  `WHATSAPP_APP_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_CONFIG_ID`; "Customers
  register their WhatsApp numbers in the dashboard at
  `/dashboard/whatsapp-accounts`."
- No token-exchange code, redirect handling, or storage detail is given in
  the README.

Applicable to Pilot (Stage A, implemented): the three env names (names
only, added to `.env.example`); a "Connect with Meta" button inside the
WhatsApp section built from server-supplied App ID + Config ID; a
server-side code-exchange callback that tests the token and does NOT
persist it (see `docs/zeromsg-linking.md`). Not applicable: ZeroMsg's
multi-client onboarding model (see below) — Pilot has one client, one
dedicated number, all assets in the client's name.

## (b) Template management (original templates + sync)

README evidence:
- Feature bullet: "Template Synchronization: View and sync official
  WhatsApp templates directly from your Meta Business account."
- No detail in the README about creating original templates, categories,
  headers, buttons, variables, or rejection reasons.

Applicable to Pilot (Stage A, implemented): keep the 10 seeded Arabic
Utility templates; full draft create/edit (name, UTILITY only, `ar` only,
header text/media/document, body with `{{1}}` placeholders, footer, up to
3 buttons, sample values); submit to Meta; sync from Meta by name
(updating `meta_status`, `meta_template_id`, rejection reason); local vs
Meta status shown separately; variables preview; send gate = locally
approved AND (when Meta is configured) Meta-approved. The create/edit/
preview/validation design is Pilot's own (the README does not specify it).

## (c) Inbox interfaces

README evidence:
- Feature bullet: "Real-time Team Inbox: Multi-agent shared inbox to handle
  incoming chats, send rich media, and utilize approved template messages."
- No detail in the README about assignment, read states, internal notes,
  or contract-scoped conversations.

Applicable to Pilot: already exists and is unchanged in Stage A (buyer/
seller conversation per contract + general conversation, assignment, read,
internal notes never shown to customers). One Stage A touch only: the
inbox template dropdown now shows both statuses (local + Meta) so staff
can see why a template is not sendable. Inbox replies remain local
records; a real WhatsApp send happens only through
`POST /api/whatsapp/send`, which enforces the new send gate. "Real-time"
in ZeroMsg's sense (live updates) is NOT claimed for Pilot — no websocket
was added.

## (d) Automation types

README evidence:
- Feature bullet: "Automation Flow Builder: Drag-and-drop or node-based
  logic to auto-reply to customers based on keywords and events. Easily
  import/export automation flows."
- No trigger/step catalogue is given in the README.

Applicable to Pilot: NOT Stage A. Pilot already has a workflow designer
(storage only, no execution) with keyword / contract-event / manual
triggers and a step palette, and a server-side ban on money steps
(release/refund/confirm/settle — rejected at save time). Automation
*execution* (including gating a template step on the new send gate) is a
later stage; this stage deliberately does not execute anything, and no
automation step may ever touch money.

## (e) Contacts

README evidence:
- Feature bullet: "Contacts & Segments: Detailed contact profiles, CSV
  import/export, and group organization."
- No schema or field list is given in the README.

Applicable to Pilot: NOT Stage A (other worker). Pilot deliberately has
no standalone contacts module yet: customers are known only as
buyer/seller phones on a contract (or a general conversation). Any future
contacts work must stay inside that boundary — no contact may be messaged
outside a contract/invitation relationship, and no CSV import may create
a broadcast audience.

## (f) File handling

README evidence: none in the README. No upload, storage, or media-handling
feature is mentioned.

Applicable to Pilot: NOT Stage A (other worker). Pilot currently stores
contract-file *metadata only* (never file bytes), and WhatsApp media sends
use a link/id supplied at send time. A media-header template field is now
stored as a link (`header_link`) in drafts; submitting a media-header
template to Meta may still fail until a proper media-upload session
exists — that is a documented limitation, not a silent success.

## What is REJECTED for Pilot (even though ZeroMsg has it)

| ZeroMsg feature | Pilot decision | Reason |
|---|---|---|
| Multi-tenant workspaces (auto-provisioned per client/team) | Rejected | Pilot is one client's system; accounts must be in the client's name, not a provider onboarding many clients. |
| Broadcast campaigns (start/pause/resume, import contacts) | Rejected as marketing | Pilot has NO marketing broadcasts. "Campaigns" here, if the word is ever used, mean only Utility service notifications tied to a contract, clearly labelled. |
| Developer API & outbound webhooks (API keys for third parties) | Not in Stage A; do not copy blindly | Would widen the attack surface; any future API needs its own auth/audit review. |
| Demo data seeding (`zeromsg:demo`, demo login) | Rejected | Pilot production data starts empty; dashboard shows 0 when empty. Test data in tests is throwaway and deleted. |
| PHP/Laravel stack | Rejected | Pilot stack stays React + Vite + TypeScript + Node built-ins. ZeroMsg is a pattern reference only. |
| Any unofficial WhatsApp path (Web QR, linked device, Baileys/Evolution/WAHA) | Banned | Only the official Meta Cloud API. See `docs/zeromsg-linking.md` for why Embedded Signup is different from a QR path. |

## What remains for later stages (not Stage A)

- Automation execution (with the send gate applied to template steps).
- File upload (real media handling; media-header template submission).
- Contacts & segments (contract-scoped only, no broadcast audience).
- UI split (separate WhatsApp sub-views) if the parent decides it.
