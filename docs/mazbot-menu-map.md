# MazBot menu map — adapted to the Pilot System (Round 3, expanded brief)

Structure only: this document maps the MazBot menu hierarchy onto Pilot
System navigation. No MazBot copy, screenshots, names, prices, or
marketing claims are reproduced. Every item below is either adopted,
adapted (with the adaptation stated), or rejected (with the reason).
Rejected items are **absent from navigation** — they are not built,
not even as disabled buttons that invite clicks, except where a scope
note is explicitly recorded here.

Scope guard for the whole map: the pilot stays closed and
invitation-only under scope V1.2 — no internal wallets, no marketplace
or catalog, no automated bank API, money only by human coordination
with an external financial institution and a financial-institution
reference, Utility templates only, no marketing broadcasts, no AI
selling or closing, official Meta Cloud API only, audit append-only.

## Dashboard
- **Adopt.** Real numbers only (demo excluded). Implemented in the
  dashboard view.

## WhatsApp
- **Overview — Adopt.** Real counts from the server (conversations,
  unread, templates, flows, linking steps, contracts), demo excluded.
- **Delivery Insights — Adopt.** Delivery status counts from actual
  stored messages (sent / delivered / read / failed / dry-run /
  internal note), plus template usage counts.
- **Meta Conversions — Adapted.** Renamed "تحويلات العقود": the
  contract funnel (draft → issued → accepted → payment_pending →
  payment_confirmed → preparing → delivered → completed). Meta ad
  conversions are rejected: this pilot runs no ads and no campaigns.
- **Contact Lists — Adopt.** Contacts linked to contracts only; no
  marketing audiences.
- **Segments — Adopt, adapted.** Segments are groups by operational
  tag only. They are never used for bulk sending — no broadcast
  endpoint exists (verified: broadcast → 404).
- **Tags — Adopt.** Real conversation tags, managed from the inbox
  and the details panel.
- **Contacts — Adopt.** CRUD, CSV import/export with dedup,
  computed Utility eligibility.
- **Auto Replies — Adopt.** Read view over the single automation
  engine, filtered to keyword / first-message / away /
  business-hours / fallback triggers; creation happens in Flow
  Builder.
- **Flow Builder — Adopt.** Visual canvas (start / message /
  template / condition / wait / handover / end), node palette,
  properties panel, drag reorder, Kill Switch on the canvas. No
  payment, broadcast, catalog, or AI-selling node type exists.
- **User Input Responses — Adopt.** The real inbound messages as
  received, with a copy button. No editing of customer messages.
- **Human handoff — Adopt.** Conversations where automation was
  paused, plus one-click handoff / resume (both server actions,
  audited).
- **Templates — Adopt.** The single template library (header / body /
  footer / buttons, submit / sync, local + Meta approval shown
  separately, send gate requires Meta approval when configured).
- **Chat Widget — Adapted to a settings page only.** Title,
  greeting, business hours, enabled flag, and a local preview are
  stored in the browser. It creates no customer website, no public
  page, and sends nothing — the pilot has no customer website by
  scope.

## Campaigns — REJECTED
Reason: marketing campaigns and scheduled mass sending contradict
the closed, invitation-only, Utility-only pilot. No campaign menu
item is built, no broadcast endpoint exists, and no template is a
marketing template. The rejection is structural, not a deferral.

## AI Agents — ADAPTED (draft-only)
- **Dashboard — Adapted.** Shows flow count, today's draft count
  against the quota, knowledge-base size, Kill Switch state. No
  auto-send status, because auto-send does not exist.
- **AI Credits — Adapted.** Local daily draft counter, not a
  purchase, not a subscription, not a payment.
- **AI Settings — Adapted.** Agent name, instructions, max draft
  length. The "draft only" mode is locked and cannot be changed to
  auto-send from this page.
- **AI Agents — Adapted.** Exactly one agent: the draft assistant.
  No sales agent, no closing agent.
- **Test Chat — Adapted.** Local simulation: a customer message
  produces a draft suggestion built from the knowledge base or a
  neutral fallback. Nothing is sent to WhatsApp.
- **Quotas — Adapted.** Daily draft limit, adjustable, with a
  same-day counter reset. No money, no credits purchase.
- **Triggers — Adapted.** Read view over the real automation engine
  triggers; the AI assistant has no independent sending trigger.
- **Business Hours — Adapted.** Local start / end / days, used only
  as a display rule for draft suggestions.
- **Knowledge Base — Adapted.** Local question → draft-answer
  entries, added and deleted from the page, used by Test Chat only.

Rejected inside AI: AI selling, AI closing deals, AI auto-replying
to customers, AI training on customer data. Reason: money decisions
and customer commitments are human-only in this pilot.

## Inbox — Adopt
The triptych workspace (list | chat | details), full height, no
cards, no page header inside the workspace, no pill sub-tabs. Phone:
list first, tap → chat, back → list; details as a drawer. Desktop:
all three panels at once at ≥ 820 px.

## Team Member — ADAPTED
- **Team Member — Adopt.** The existing user management (roles,
  departments, per-user sections and actions, backend-enforced 403).
- **Team Performance & KPIs — Adapted.** Real workload metrics:
  assigned conversations, outbound replies, unread per member.
  No sales targets, no lead metrics.
- **Lead Distribution — Adapted.** Renamed "توزيع المهام":
  unassigned open conversations distributed to the least-loaded
  member, one by one, each assignment audited. No lead selling.
- **QA Settings — Adopt, adapted.** Human-review toggles; the two
  money/template gates are locked on (they are system constraints,
  not preferences).

## My Ticket — Adopt
Tasks assigned to the signed-in operator (matched by name or
email), with server-backed complete / cancel actions, audited.

## Ideas & Feedback — Adopt
Local browser-stored list (idea / note / bug) with status toggle
and delete. Not an external support channel; nothing is sent
anywhere.

## Invite & earn — REJECTED
Reason: a referral/earning program contradicts the closed,
invitation-only pilot and has no place in a contract-trust system.
No menu item, no referral code, no reward logic.

## Setting
- **WhatsApp — Adopt.** The WhatsApp settings inside WhatsApp
  (linking wizard, Embedded Signup, media, templates settings);
  system settings hold only roles and security.
- **General Setting — Adopt.** System settings (site title,
  language, theme, session) — labelled "إعدادات عامة".
- **Billing Details — Adapted to a usage display only.** Plan label
  (Pilot — closed), real usage counts. No payment form, no card
  input, no collection: hosting and Meta costs are paid outside
  the system, in the client's name.
- **Webhook — Adopt.** Live linking data: webhook URL, app base
  URL, configured / not-configured flags for verify token, HMAC
  secret, WABA, phone number; subscribed fields listed. No secret
  value is ever shown.

## API — Adopt (documentation only)
A catalogue of internal endpoints with method, path, required
permission, and description. Deliberately no key generation: any
external integration must go through owner approval and server
environment configuration, not a button in the UI.

## Integrations — Adopt (status page only)
Real status rows: Meta Cloud API, PostgreSQL (pending — schema
exists, runtime still JSON), manual financial institution,
hosting, private GitHub repo. No integration is shown as
"connected" unless it is actually connected.

## What this map deliberately does NOT contain
Campaigns, Invite & earn, store sync / catalog, marketing
templates, bulk/broadcast sending, AI selling or closing, in-chat
payments, WhatsApp Web QR, customer website or public registration.
Each omission is a scope decision, not missing work.
