# Provider dashboard structure — what was studied, adapted, and deliberately excluded

Source: web research on real WhatsApp provider dashboards (WATI, respond.io,
Interakt, 360dialog / get.chat, Twilio, Chatwoot). This document records the
pattern found there and how it was adapted to this trust service. It is a
design record, not a vendor endorsement, and it contains no credentials.

## Providers studied

- **WATI** — team inbox, templates, flows/automation, analytics.
- **respond.io** — shared inbox with assignment, granular per-module access
  (Owner / Manager / Agent splits with per-module permissions).
- **Interakt** — inbox, templates, campaigns, catalog-adjacent commerce.
- **360dialog / get.chat** — channel connection (Meta Business, WABA,
  verified number, webhook health) and template management.
- **Twilio** — channel/API connection and messaging plumbing.
- **Chatwoot** — open-source team inbox with assignment, internal notes,
  labels/statuses, and reports.

## The shared pattern (7 elements)

1. **A shared team inbox as the centre**: conversation list + chat pane,
   assignment to an agent/team, internal notes invisible to customers,
   saved replies/templates, and status/labels.
2. **A channel/connection area**: Meta Business + WABA + verified number +
   webhook status + health.
3. **Templates managed separately**, with Meta approval status; only
   approved templates may be sent outside the 24-hour customer-service
   window.
4. **Automation/flows as a visual builder**: triggers, conditions, replies,
   assignment and human handover — never money actions.
5. **Contacts tied to conversations**.
6. **Teams/roles under Settings**, with Owner/Manager/Agent splits and, in
   respond.io, granular per-module access.
7. **Dashboard widgets** (open conversations, team workload, unread) and
   reports/audit.

## What was adapted to this trust service

| Provider pattern | Pilot System adaptation |
|---|---|
| Shared team inbox | Inbox is **per-contract buyer/seller** (two conversations per contract), with assignment to a team member, internal notes never shown to customers, saved replies via the 10 Utility templates, and statuses (new/open/pending/resolved/closed). New: an "Assigned to me" filter. |
| Channel/connection area | WhatsApp tab: linking steps (Meta Business, WABA, verified dedicated number), settings (environment-variable **names only**), and webhook status (booleans only: verify token set, HMAC enabled, access token set — never values). |
| Templates with approval status | The 10 Utility templates, with Meta approval status (pending/approved/rejected) editable by `whatsapp:edit` holders; approval status is shown on every reply. |
| Visual flow builder | Automation tab: rules + flow designer (triggers, conditions, replies, assignment, human handover). No money step type exists in the palette and the backend rejects banned step types with 400. |
| Contacts tied to conversations | Contacts here are **buyer/seller per contract only** — there is no contact directory, no discovery, and no matching. |
| Teams/roles under Settings | Users tab + permission model: 5 roles, 4 departments, per-user section/action overrides, all enforced by the backend on every endpoint (see README). |
| Dashboard widgets + reports | Dashboard widgets: open conversations, team workload (conversations per assignee), unread counts; Audit tab is the append-only report of record. |

## What was deliberately NOT copied, and why

- **Broadcasts / marketing campaigns** — this is a closed, invite-only
  trust pilot, not a marketing tool; broadcasts would invite unsolicited
  outreach and break the scope.
- **Catalogs** — no marketplace and no product catalog exist in this
  project by rule.
- **In-chat payments** — money stays with an external financial
  institution under manual coordination; no payment action may run inside
  a chat, a flow, or an automation rule.
- **AI agents selling** — no agent may negotiate, promise, or close a
  deal; human handover is the only escalation path.
- **Shopify / order automation** — order automation would reintroduce a
  store and automated money-adjacent actions through the back door.

## Navigation that resulted from this pattern

لوحة القيادة (Dashboard) · العقود (قائمة، عقد جديد، النسخ، مهام التشغيل)
· الإنبكس والدردشة (المحادثات، عرض الدردشة، المعيّنة لي، الملاحظات
الداخلية) · واتساب (الربط والتوصيل، القوالب، الإعدادات، حالة Webhook)
· الأتمتة (القواعد، مصمّم التدفقات، مفتاح الإيقاف) · المستخدمون (قائمة،
إضافة، كلمات السر، الصلاحيات، الأقسام) · التدقيق والتقارير · إعدادات
النظام (إعدادات النظام، قائمة الربط — 10 خطوات). The sidebar renders only
the sections the logged-in user's permissions allow; opening a forbidden
section directly (e.g. via URL hash) shows "لا صلاحية لديك لعرض هذا القسم".
