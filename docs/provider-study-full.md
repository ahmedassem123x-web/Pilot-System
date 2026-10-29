# Provider study — full (PASS 1, study only)

**Date:** 2026-10-29. **Scope:** PASS 1 only — reading and documentation.
No frontend or backend code was edited for this study, nothing was pushed
to GitHub, and no credential, token, secret, phone number or WABA value
appears in this document.

**Pilot System rules this study is judged against (do not re-litigate here):**
closed WhatsApp trust/contract system; 12-state contracts; money stays
with an external financial institution under manual coordination — no
wallets, no marketplace, no bank API, no money automation; Utility
templates only, no marketing broadcasts; official Meta Cloud API only —
NO WhatsApp Web QR / Baileys / Evolution / WAHA ban-risk paths; accounts
in the client's name; one dedicated Cloud API number; stack React +
Vite + TypeScript + Node built-ins; dark teal `#0f3d3a`; phone = top tab
bar, web/desktop = side sidebar, breakpoint 820px; Arabic RTL.

**Method and honesty note.** Sources are the public pages listed at the
end of each section, fetched as text on 2026-10-29. Vendor marketing
pages describe modules and behaviour, not pixel layouts: where a public
source does not describe a detail (for example date separators, quoted
replies, or tick colours inside a vendor's own inbox), this study says
so explicitly instead of inventing it. Chat-display details that ARE
documented come mainly from three places: WhatsApp Web itself (the
display reference every vendor imitates), the Kapso open-source inbox
(whose code structure is public), and Chatwoot (whose 24-hour-window
behaviour is documented in its own help centre). Do not treat a vendor's
marketing claim as a verified in-product screenshot.

**How to read "Adopt / Reject" below.** "Adopt" means a structural
pattern Pilot System may copy in its own code. "Reject" means the
pattern must not enter Pilot System even if the vendor ships it, with
the Pilot rule it would break. Several vendors are therefore marked
"adopt the inbox skeleton, reject the campaign/commerce layer" — that
split is the whole point of this study.

---

## 1. WATI

**What it is (structure, not pitch).** A WhatsApp-first, then
omnichannel, team platform built on the official WhatsApp Business API.
Top-level navigation reported in independent reviews: Team Inbox,
Broadcast, Contacts, Automations, Analytics, Ads, plus Settings. The
left sidebar is described as holding Contacts, Broadcasts, Automations
— i.e. a conventional left-nav + main-pane product, not a
drawer-inside-chat design.

**Layout hierarchy.** Top-level: Team Inbox (the working centre) >
Broadcast (campaigns) > Contacts (directory) > Automations (rules and
flows) > Analytics > Ads. Inbox itself is the familiar three-part
shape shared by almost every vendor here: conversation list on one
side, active conversation in the middle, contact details on the other
side (WATI's own inbox page is described in reviews as showing "a chat
list, a WhatsApp conversation and a contact panel" side by side).

**Inbox structure.** Shared team inbox: multiple agents work one
WhatsApp number; chats are assigned to teammates, with round-robin
assignment on higher plans, auto-reassignment of chats that wait too
long, and skipping offline agents. Filtering/tagging by team and by
conversation tags is reported; internal notes exist (reviewers cite
"internal notes that clients cannot see" and tagging by project stage).
A "CX Score" rates conversations so leads can spot unhappy customers
fast. Mobile access is via a mobile app plus a mobile-friendly web app.

**Chat display details.** Public sources do NOT document WATI's bubble
rendering in detail (no statement found on date separators, quoted
replies, tick colours, or media-bubble treatment inside WATI itself).
What is documented: interactive messages (buttons such as buy/book/
reschedule) are supported, saved/quick replies exist, AI can summarise
a conversation and suggest a reply, and one-click AI translation is
offered. Do not assume WATI's ticks or separators match WhatsApp Web's
— that is unproven from the sources read.

**Automation model.** Two layers: (a) rule-based automation — a keyword
or condition triggers a reply; (b) a no-code chatbot/flow builder —
blocks joined into a flow that can send messages, ask questions, set
conditions, collect data (budget, date, need), and assign the chat to
sales. Plus welcome/away replies, and an AI layer ("Astra") that
qualifies leads and hands over to a human. WATI also documents a
coexistence onboarding path: a WhatsApp Business App number can keep
running on the phone while connected to the platform, with app
greeting/away messages to be switched off first to avoid duplicate
replies, and a warning that Click-to-WhatsApp first messages may not
sync during high traffic.

**Templates model.** Template management with submission and approval
tracking; templates are the vehicle for broadcasts and for scheduled /
retargeted sends. Broadcasts are a first-class, high-volume feature
(15,000/month quoted on one plan tier in a comparison, unlimited on
higher tiers, Meta fees still applying).

**Contacts model.** Contacts tab with filters, attributes and tags;
segments can be built from fixed attributes and, on newer plans, from
engagement behaviour (campaign opens, link clicks, messages, calls).
CRM sync (Shopify, HubSpot, Salesforce on higher plans, Zapier) matches
contacts by phone number.

**Reports.** Analytics dashboard: open rates, response times, agent
performance, conversion metrics, campaign performance; operator reports
for assignment and resolution tracking.

**Adopt for Pilot.** (1) Shared inbox with assignment + round-robin
awareness + "reassign if waiting too long" as a manual-ops task, not an
automatic money action. (2) Internal notes + tags as the collaboration
layer inside a conversation. (3) Quick/saved replies as a first-class
composer element. (4) Coexistence lesson: if a number ever coexists,
switch off app-side auto-replies first so customers never get two
answers — Pilot's dedicated-number rule already avoids this, but the
checklist should keep the warning. (5) Waiting-time visibility (a
"CX-style" stalled-chat signal) as an ops report, not a score shown to
customers.

**REJECT for Pilot, and why.** Broadcasts / segmented campaigns /
retargeting — marketing outreach, forbidden: Pilot is closed and
invite/contract-scoped only. Click-to-WhatsApp ad capture and Ads
reporting — acquisition marketing, out of scope. Catalog / Shopify
abandoned-cart templates — marketplace/commerce, forbidden. AI agents
that qualify and close leads ("ready-to-buy" handover) — AI selling,
forbidden; Pilot's only escalation is human handoff. AI-suggested
replies may be studied later only as drafts a human sends, never as
autonomous selling.

**Sources.**
- https://www.wati.io/omnichannel-inbox/
- https://www.findmyresponse.com/wati-io-the-whatsapp-automation-tool-thats-like-a-sales-superhero-review
- https://chatimize.com/reviews/wati/
- https://support.wati.io/en/articles/11822421-how-to-connect-your-whatsapp-number-to-wati-via-whatsapp-coexistence-coex
- https://www.eesel.ai/blog/whatsapp-customer-service-platform

---

## 2. respond.io

**What it is.** An omnichannel conversation platform: one inbox across
WhatsApp, Messenger, Instagram, Telegram, LINE, Viber, WeChat, email
and web chat, with workflows and AI agents on top. It is the most
"platform-shaped" vendor in this study — modules, not just an inbox.

**Layout hierarchy (best-documented of the commercial vendors).**
Left-hand side navigation, top-level modules in this order: Dashboard
(landing view, Owners/Managers only) > Notifications > Inbox >
Contacts > AI Agents > Broadcasts > Workflows > Reports > Settings.
Mobile app supports only Notifications, Inbox and personal Settings;
Dashboard, Contacts, AI Agents, Broadcasts, Workflows and Reports are
web-only. That web/mobile split is itself a pattern worth copying:
do not pretend every module works on a phone.

**Inbox structure.** Shared inbox with custom inboxes (queues) and
team inboxes on every plan. Conversations carry: assignee, lifecycle
stage (lead → customer journey view, not an isolated ticket),
channel badge, tags, and internal comments with @mentions. Agents can
collaborate via private comments/threads without leaving the
conversation. Routing rules assign by channel, keyword, tag, time of
day, or availability; unroutable items sit in an Unassigned queue for
the next available agent. The Dashboard module's widgets are: Contacts
(open conversations, avatar + name + last message + duration open +
assignee, longest-open first), Team Members (avatar, name, status,
team, assigned contacts), Conversations (opened/closed counts over
Today / Yesterday / Last 14 / 30 days), Merge Suggestions, Upcoming
Broadcasts.

**Chat display details.** Public sources do NOT document respond.io's
bubble rendering (ticks, separators, quoted replies, media bubbles) in
usable detail. Documented: contact context in the inbox sidebar
(including, via integrations, a contact's upcoming/past calendar
meetings matched by email), internal comments, and AI-agent context
summaries. The lifecycle view — every chat shown as one step in a
customer journey — is the distinctive display idea, and it maps
directly onto Pilot's contract-state view if the "journey" is the
contract's 12 states rather than a sales funnel.

**Automation model.** Visual Workflow builder (Growth plan and up):
trigger → conditions/branches → actions, including routing, AI
objectives, CRM updates, reminders, surveys, escalations, and webhook
calls. AI Agents (Growth and up, credit-metered) answer FAQs, qualify
leads, book appointments, read attachments, tag automatically, call
external APIs, and hand off to a human — with "instant human takeover"
as the stated guardrail. Workflows and AI Agents are documented as
interlocking (an AI Agent can trigger a Workflow for CRM updates or
surveys), which reviewers note is not always clearly explained.

**Templates model.** Templates are used for broadcasts and for
starting conversations; the platform passes Meta's per-message fees
through without markup (stated as a differentiator). No template
editor structure (header/body/footer/buttons) is documented in the
sources read beyond that.

**Contacts model.** Contacts module is a full database: every
conversation enriches a profile (purchase history, previous
conversations, tags, notes), with two-way CRM sync (HubSpot,
Salesforce, Pipedrive) and a Lifecycle field. Merge Suggestions on the
Dashboard propose duplicate contacts to combine.

**Reports.** Reports module: per-agent conversation counts, first-
response time, resolution time, workload distribution, queue
slow-downs. The stated use is managerial — set first-response targets,
move agents to busy queues early — not customer-facing scoring.

**Adopt for Pilot.** (1) The module map itself: Dashboard / Inbox /
Contacts / Workflows / Reports / Settings as top-level sections, with
an explicit web-only vs phone-available split. (2) Unassigned queue +
"assigned to me" as the two triage views. (3) Lifecycle-as-state:
Pilot already has this in contract states; the inbox header should
always show the linked contract's state next to the assignee. (4)
Internal comments with @mentions, kept invisible to the customer.
(5) First-response-time reporting (Pilot already tracks it for audit;
surface it as a report, not a live scoreboard). (6) Merge/duplicate
awareness for contacts — Pilot's version is recognising that buyer and
seller phones on one contract are two distinct parties, never merged.

**REJECT for Pilot, and why.** Broadcasts and Upcoming Broadcasts
widget — marketing, forbidden. AI Agents that qualify leads, book, or
close — AI selling/negotiation, forbidden; human handover only.
Catalog reading by AI agents to answer pricing/availability —
commerce, forbidden. Revenue attribution and Click-to-WhatsApp
conversion tracking — marketing funnel, out of scope. Omnichannel
expansion (Instagram, Telegram, email in one inbox) — Pilot is
WhatsApp-only by scope; adding channels would dilute the audit trail.

**Sources.**
- http://respond.io/blog/whatsapp-team-inbox
- https://respond.io/blog/respondio-whatsapp
- https://respond.io/help/mobile-app/mobile-app-overview
- https://Respond.io/help/dashboard-reporting/dashboard
- https://chatimize.com/reviews/respond-io/
- https://www.eesel.ai/blog/whatsapp-customer-service-platform

---

## 3. Interakt

**What it is.** An India-first WhatsApp Business platform from a Meta
Business Solution Provider, positioned for marketing/sales teams and
e-commerce (especially Shopify/D2C). It is the clearest example in
this study of "inbox that grew around campaigns" — the inverse of
WATI's "campaigns added to an inbox", and the most cautionary for
Pilot.

**Layout hierarchy.** Shared team inbox as the working centre, with
Campaign/Broadcast manager, Contacts/CRM, Automation/chatbot builder,
and integrations as sibling top-level areas. Exact sidebar order is
not documented in the sources read; the module set (inbox, campaigns,
contacts, automation, analytics) is consistent across sources.

**Inbox structure.** Shared team inbox: multiple agents on one number,
assignment, conversation labels, private notes, pre-configured
templates for instant replies, and agent response-time tracking.
Welcome messages are supported. The inbox is explicitly described as
the place where support, sales and promotion replies all land — which
is exactly the mixing Pilot must not do.

**Chat display details.** Public sources do NOT document Interakt's
bubble rendering (ticks, separators, quotes, media) in usable detail.
Documented display-adjacent facts: catalog messages (up to 30 products
with images, descriptions, prices) can be sent inside a chat, and
interactive CTA buttons are used for lead generation.

**Automation model.** Keyword-based auto-replies, saved replies,
chatbot flow builder with conditional logic, automated notification
engine (message triggers from a connected store or API), welcome
messages, and AI agents as a separate product. Order-update, shipping
and payment-reminder triggers are the core automation story.

**Templates model.** Rich templates with customer attributes for
recurring promotional campaigns; segmentation by attributes/behaviour;
scheduling; delivery/read reporting per campaign. Templates are
categorised through Meta's approval process (marketing vs utility
cost difference is noted in BSP guides generally).

**Contacts model.** CRM functionality: customer data segregated for
retargeting, multi-language templates, Shopify/WooCommerce/Zoho/
HubSpot connectors, and contact segmentation for campaigns.

**Reports.** Campaign delivery/read reports, agent response-time
tracking, and per-campaign performance review.

**Adopt for Pilot.** (1) Private notes + labels + pre-configured
replies inside the inbox — same as WATI/respond.io, and Pilot already
has all three. (2) Agent response-time tracking as an ops metric.
(3) The notification-engine *shape* — trigger → approved template →
named recipient — but restricted to contract events only (state
changes, manual-ops reminders), never store/order events. (4)
Multi-language template awareness: Pilot's templates are Arabic-only
by rule, but the template record should still carry an explicit
language code, so a future second language cannot silently mix into
Arabic sends.

**REJECT for Pilot, and why.** Broadcast campaigns, segmentation for
retargeting, recurring promotional campaigns — marketing, forbidden.
Catalog (30-product messages, in-chat ordering) — marketplace,
forbidden. Abandoned-cart reminders with checkout links, COD
double-confirmation, order/shipping/payment automation — commerce and
money-adjacent automation, forbidden; Pilot's money steps are manual
and external. UPI/payment-gateway integration — payments inside the
system, forbidden. Instagram automation — out-of-scope channel.

**Sources.**
- https://www.techjockey.com/detail/interakt/
- https://www.whatsapptools.com/tools/marketing-broadcasting/interakt
- https://trengo.com/blog/whatsapp-business-api-partners
- https://dev.to/dawnofgenx/whatsapp-business-api-vs-wati-vs-interakt-which-one-should-you-choose-in-2026-57n
- https://medium.com/@usisimamexy/9-best-tools-for-whatsapp-broadcast-messages-in-2026-what-we-found-dfc1e425337e

---

## 4. Chatwoot

**What it is.** Open-source (MIT core), self-hostable customer
engagement suite: Ruby on Rails backend, Vue.js SPA frontend,
PostgreSQL + Redis + Sidekiq + ActionCable websockets. Channels:
website live chat, email, WhatsApp (Cloud API, Twilio or 360dialog),
Facebook, Instagram, Telegram, LINE, SMS, API channel. Cloud hosting
is also sold. This is the closest structural cousin to Pilot's own
build (self-hosted, auditable, no per-agent seat logic in the core).

**Layout hierarchy.** Top-level: Inbox (shared, multi-brand capable)
> Contacts (CRM) > Reports > Settings (inboxes, teams, agents,
canned responses, macros, automation rules, custom attributes).
Inside a conversation the layout is three columns: conversation list
(left) | active conversation (centre) | contact panel (right, with
contact details, notes, labels, previous conversations). This
list–chat–panel triptych is the single most-copied layout in the
industry, and Pilot's workspace already follows it on desktop.

**Inbox structure.** Shared team inbox with: assignment to agent or
team (team = anyone may pick up; agent = named ownership), auto-
assignment by availability/load/channel/label/round-robin, statuses
(open / resolved, with snooze in newer versions), labels, saved
filters, bulk actions, and conversation search. Unassigned and
"Mine" views are standard. Private notes with @mentions are invisible
to the customer; macros are manual one-click bundles (e.g. add label
+ resolve) whose internal steps are invisible — only a macro's
Send-Message action reaches the customer. That macro/private-note
invisibility rule is exactly Pilot's internal-note rule, stated more
precisely than most vendors state it.

**Chat display details — the best-documented in this study.**
- 24-hour window: when the window has closed, Chatwoot's reply box
  shows the literal text "You can only reply using a template message
  due to 24-hour message window restriction"; as soon as the customer
  replies, a new window opens and free typing returns. This is the
  reference implementation of Pilot's existing 24h badge — Pilot
  should keep the same swap (composer → template picker) rather than
  a disabled box with no explanation.
- Templates are created and approved OUTSIDE Chatwoot (in WhatsApp
  Manager), then synced in (automatically after a delay, or immediately
  via a "Sync Templates" button in the inbox Configuration tab);
  administrators sync, agents only send; only approved templates of a
  supported type appear. Twilio inboxes sync manually only.
- Canned responses: type `/` in the reply box to search and insert a
  saved reply, editable before sending.
- Contact panel: CRM record, contact notes (calls, emails, meetings),
  custom attributes (e.g. account ID, subscription state — the fields
  the team actually needs, not a generic CRM's fields), full previous-
  conversation history, and (via Shopify) order data in the panel.
- Reports: response time, resolution time, agent load, tracked
  automatically.
- What is NOT documented in the sources read: tick colours, date
  separators, quoted-reply rendering, and media-bubble treatment
  inside Chatwoot's own thread view. Those must not be attributed to
  Chatwoot; see §10 (WhatsApp Web) for the display reference.

**Automation model.** Two distinct tools, and the distinction matters
for Pilot: (a) Automation Rules — automatic, trigger-based (e.g.
auto-label a conversation containing a keyword); (b) Macros — manual,
agent-triggered bundles. Plus Captain AI (automated answers from help
centre/FAQs/past chats; Copilot draft suggestions for agents).
Pilot already mirrors the rules-vs-macros split (rules/designer as
views, macros as manual runs) and must keep it: automatic steps need
the Kill Switch and the money-step ban; manual macros need an audit
entry naming the operator.

**Templates model.** See chat display above: external creation +
approval, in-product sync, dual status in effect (Meta approval vs
local availability), agent/admin permission split. Pilot's current
design (local approval + Meta approval shown separately, send gate
requiring both when Meta is configured) is stricter and better than
Chatwoot's sync-only model, because Pilot also authors templates
in-product; keep the stricter gate.

**Contacts model.** CRM-style contacts with notes, custom attributes,
labels, and full history; contacts can be created/updated via API and
webhooks. Multi-brand shared inboxes keep brands' conversations in one
queue with per-inbox routing.

**Reports.** Response time, resolution time, agent load; per-inbox and
per-agent views; conversation labels as the reporting dimension
("label on closing — even just one — pays off enormously when you
look at reports later" is the Chatwoot guide's own advice, and it
applies directly to Pilot's contract-close labelling).

**Adopt for Pilot.** (1) The list–chat–panel triptych, with the panel
collapsible on phone (list-top / chat-below, drawer below or hidden —
Pilot's 820px rule already does this). (2) The exact 24h composer swap
with explanatory text, not a silent disable. (3) `/` quick-reply
insertion, editable before send. (4) Rules (automatic) vs macros
(manual) as separate, labelled tools. (5) Team vs agent assignment
semantics. (6) Label-on-close as an ops habit, feeding reports.
(7) Saved filters (Unassigned / Mine / Unread / By label) as
one-tap chips above the list. (8) Self-hosted auditability: every
action traceable to an operator — Pilot's append-only audit log is
the same idea, applied to contracts as well as chats.

**REJECT for Pilot, and why.** Captain AI automated answers — autonomous
AI replies, forbidden in Pilot's trust context (drafts a human sends
are a different, later question). Shopify order data in the contact
panel — commerce, forbidden. Multi-brand shared inboxes — Pilot is
one client; do not build multi-tenancy. API-channel / email / social
channels in the same queue — WhatsApp-only scope.

**Sources.**
- https://www.chatwoot.net/
- https://www.chatwoot.com/hc/user-guide/articles/1754940076-whatsapp-templates
- https://chatwoot.help/hc/user-guide/en/categories/chatwoot-101
- https://devopspack.com/chatwoot-open-source-customer-support-intercom-alternative/
- https://raw.githubusercontent.com/alif-softwares/chatwoot-momsmop/master/README.md

---

## 5. OpenBSP

**What it is.** An open-source WhatsApp Business Platform (Supabase
stack, production multi-tenant since 2023) by Matias Battocchia:
API repo `github.com/matiasbattocchia/open-bsp-api`, UI repo
`github.com/matiasbattocchia/open-bsp-ui`, live demo at
`web.openbsp.dev`. It is included here as an architecture reference,
not a UI reference: the public material read for this study is a
backend-patterns article, not a UI tour, so UI claims below are
marked accordingly.

**Layout hierarchy.** Not documented in the sources read. The data
model is documented instead: every table belongs to an organization;
users may belong to multiple organizations with roles owner / admin /
member; API-key authentication exists alongside JWT authentication.
Do not infer a sidebar or inbox layout for OpenBSP from this study.

**Inbox / chat display.** Not documented in the sources read (no
conversation-list, bubble, tick, or panel description was found in
the article). The message model IS documented: a `messages` table
with `direction` (incoming/outgoing), a `status` JSON object that
accumulates timestamped keys (`pending`, then `sent`, …) by merge
rather than overwrite, and a `content` JSON object with a `type`
(including `file` for attachments).

**Automation model.** Event-driven, and this is OpenBSP's most
transferable idea: Postgres triggers on message insert route by
`WHEN` clause — incoming + pending → AI-agent edge function;
outgoing + pending + due → WhatsApp dispatcher; any direction +
`file` content → media preprocessor. The trigger's `WHEN` clause is
the router; the edge function is generic (`tg_argv` path + method);
delivery is asynchronous (pg_net) so the insert returns immediately;
secrets live in Supabase Vault, not environment variables. Pilot's
equivalent is its automation engine + Kill Switch + audit log; the
adoptable lesson is "route on a small set of explicit conditions,
never on free-form if/else in the handler", and "status is an
append-only history, never an overwrite".

**Templates / contacts / reports.** Not documented in the sources
read, beyond the schema listing naming `contacts`, `conversations`,
`agents`, `organizations` and `messages` tables. No template, contact-
field, or report claim is made for OpenBSP in this study.

**Adopt for Pilot.** (1) Status-as-history: a message's delivery
state should accumulate (sent → delivered → read → failed, each
timestamped) rather than replacing a single status string — Pilot's
bubbles already show sent/delivered/read/failed, and the backend
should keep the timestamps behind them. (2) Role hierarchy as numbers
(owner 3 / admin 2 / member 1) with a single `>=` check — Pilot's
5-role + per-user-override model is richer, but the same "one
predicate, everywhere" discipline applies to its backend enforcement.
(3) Trigger-condition routing as a design review lens for Pilot's
automation engine: every rule's trigger conditions should be readable
as a `WHEN` clause. (4) Declarative schema as source of truth (schema
files, diff-generated migrations) — relevant when Pilot moves to
Postgres (already a known remaining step), not a UI change.

**REJECT for Pilot, and why.** Multi-tenant organizations with
auto-provisioning — Pilot is one client, forbidden. Built-in AI agent
on every incoming message — autonomous AI, forbidden. API-key
service-to-service access as a general feature — widens attack
surface; Pilot deliberately has no third-party developer API (see
ZeroMsg §6). Supabase stack itself — Pilot stack stays React +
Node built-ins; OpenBSP is a pattern reference only.

**Sources.**
- https://dev.to/cabra/5-supabase-patterns-i-learned-building-an-open-source-whatsapp-platform-2h19
- https://openbsp.dev/privacy-policy/ (account/data-deletion behaviour only)

---

## 6. ZeroMsg (megoxv/zeromsg)

**What it is.** Self-hosted WhatsApp Cloud API dashboard (Laravel 13
+ Inertia React, MIT), plus a hosted Cloud edition. Tagline in its
own README: "Self-hosted WhatsApp Cloud API inbox, campaigns,
automations, and developer API." Pilot's own prior study
(`docs/zeromsg-study.md`, 2026-10-29, README-only, no code copied)
already covers linking and templates in depth; this section records
only what is new or structurally relevant here, and does not repeat
that study's implementation notes.

**Layout hierarchy.** Workspace-based: multi-tenant workspaces
(auto-provisioned per client/team) each containing numbers, inbox,
campaigns, automations, templates, contacts and developer API. The
README's feature order — workspace → numbers → inbox → campaigns →
automations → templates → contacts → API — is the navigation shape.
Pilot already rejected the workspace/multi-tenant layer; its
equivalent is a single workspace (one client, one number) with the
same inner sections.

**Inbox structure.** Real-time team inbox: multi-agent shared inbox,
rich media sends, approved template messages. The README does not
document assignment, read states, internal notes, labels, or
contract-scoping — those are Pilot's own additions, not ZeroMsg's.
Pilot's inbox (buyer/seller conversation per contract + general
conversation) is therefore structurally stricter than ZeroMsg's.

**Chat display details.** Not documented in the README beyond "rich
media" and "approved template messages". No tick, separator, quote,
or panel claim is made for ZeroMsg here.

**Automation model.** Drag-and-drop / node-based flow builder:
auto-reply on keywords and events, import/export of flows. No
trigger/step catalogue is given in the README — Pilot's catalogue
(keyword / first-message / button / contract-event / business-hours /
fallback / manual triggers; ask-wait / branch / assign / label / note
/ task / webhook-out / handoff actions; loop/cooldown guards; money
steps rejected recursively) is Pilot's own design and is stricter.

**Templates model.** Template synchronisation from Meta (view and
sync official templates from the business account) plus, in the
hosted edition, a transactional-only "Notify" plan (pre-approved
templates, platform number, no chat replies, no custom templates, no
bulk marketing) versus a "Professional" plan (own Meta account and
number, full inbox, builders, campaigns, custom templates, no markup
on Meta message costs). Pilot's model (author in-product + submit +
sync, local vs Meta status separate, send gate requiring both) is
again stricter than sync-only.

**Contacts model.** Detailed contact profiles, CSV import/export,
segments/groups. Pilot deliberately has no standalone contacts
module: customers exist only as buyer/seller phones on a contract
(or a general conversation). Any future contacts work must stay
contract-scoped and must never create a broadcast audience from an
import.

**Reports.** Not documented as a separate module in the README
beyond campaign controls (start / pause / resume) and performance
implied by campaigns. No report structure is claimed here.

**Adopt for Pilot (already adopted in the 2026-10-29 upgrade, listed
for completeness).** Embedded Signup from inside the dashboard
(official Meta OAuth; token tested, not persisted; production token
via environment + redeploy); template submit/sync with local+Meta
status separate; executing automation with guards and Kill Switch;
real file upload with size cap and sanitised names; contacts CRUD
with computed eligibility but NO broadcast endpoint; WhatsApp split
into 7 sub-interfaces (Linking/Accounts, Inbox, Templates,
Automation, Contacts, Media, Settings). This study endorses keeping
that split and does NOT propose re-merging it.

**REJECT for Pilot, and why.** Multi-tenant workspaces — one client
only. Broadcast campaigns (start/pause/resume, contact import as
audience) — marketing, forbidden. Developer API + outbound webhooks
for third parties — attack surface, not approved. Demo data seeding —
production starts empty. The older ZeroMsg Laravel package's
device/API-key model (a different product line under the same name,
seen in unrelated tutorials) — not the Cloud API dashboard, and any
device-based sending would be a ban-risk path. PHP/Laravel stack —
Pilot stack unchanged.

**Sources.**
- https://root.packagist.org/packages/megoxv/zeromsg (README mirror)
- https://zeromsg.com/en
- `docs/zeromsg-study.md`, `docs/zeromsg-linking.md`,
  `docs/zeromsg-adaptation.md` (Pilot's own prior studies, in-repo)

---

## 7. Kapso — WhatsApp Cloud Inbox (gokapso/whatsapp-cloud-inbox)

**What it is.** Two things must not be confused: (a) Kapso the
developer platform (TypeScript SDK mirroring Meta's Cloud API, proxy
with stored conversation/message/contact/call history, Supabase
backup, webhooks, Flows, multi-tenant onboarding links); (b) Kapso's
open-source reference inbox (`gokapso/whatsapp-cloud-inbox`, React +
Next.js), which is the UI reference studied here. The reference
inbox is explicitly "WhatsApp Web-style".

**Layout hierarchy (reference inbox).** Single-page structure:
`ConversationList` + `MessageView` as the two top-level components,
with dialog components for template and interactive-message
composition. API routes under `/api` (one per concern: conversations,
messages, media, templates) act as a backend-for-frontend; a single
client module proxies to the Kapso API, which proxies to Meta's
Cloud API. There is no separate Contacts / Campaigns / Reports
module in the reference inbox — it is deliberately a minimal inbox,
and that minimalism is its lesson for Pilot: an inbox does not need
to be a CRM to be complete.

**Inbox structure.** Conversation list + message view; conversations
queried across a project, messages listed per conversation, contacts
listed/get/updated with a customer-ID filter. Identity note from the
changelog: inbox contact/conversation panels now show business-
scoped user IDs and usernames alongside (or instead of) phone
numbers, and phone fields can be nullable where Meta only supplies a
business-scoped ID — outbound sending stays phone-based. Pilot
should note this for later: display name and phone are not always
the same identifier, and the UI must not crash or blank a row when
only a scoped ID arrives.

**Chat display details — documented, and the closest to WhatsApp
Web among the code references.**
- Template messages: full support including parameterised headers,
  bodies and buttons; composition via a dialog (not inline typing).
- Interactive messages: button-based, up to 3 custom actions.
- Media: send and receive images, videos, audio, documents.
- 24-hour window: UI and backend restrict regular messaging outside
  the window; the UI "automatically restricts message input and
  guides users accordingly" (the same composer-swap idea as
  Chatwoot, stated less literally).
- Delivery feedback: visual indicators for failed delivery.
- Message types table: text, media, template (with dynamic
  parameters), interactive, failed-message indicator.
- Refresh model: polling, not websockets — conversations every
  10 seconds, messages every 5 seconds, plus manual refresh. Pilot
  should note the trade-off explicitly: polling is simpler and
  auditable, but a 5–10s lag is visible to operators; if Pilot keeps
  its current non-realtime model, say so in the UI (a "last updated"
  hint) rather than implying live sync.
- What is NOT documented for Kapso's inbox: avatars, last-message
  preview format, unread badge style, tick colours, date separators,
  quoted replies, or a contact drawer. Those are WhatsApp Web
  conventions (§10), not Kapso claims.

**Automation model (Kapso platform, not the reference inbox).**
Workflow builder for deterministic automations and AI agents, plus
WhatsApp Flows (in-chat mini-apps via serverless functions) and
webhook normalisation with signature verification. The reference
inbox itself has no automation builder — automation lives in the
platform layer, a separation Pilot already mirrors (automation
engine separate from the workspace view).

**Templates model.** SDK-level: list/create/delete templates on the
business account, strict template-creation builders, send-time
payload builders accepting Meta-style raw components. Inbox-level:
template dialog with parameter support. This two-layer shape
(builder + dialog) matches Pilot's draft → submit → sync → send-gate
shape.

**Contacts model.** Platform-level contacts API (list/get/update,
customer-ID filter); inbox-level contact display in panels. No
segmentation or broadcast-audience model in the reference inbox.

**Reports.** None in the reference inbox. Platform-level observability
is the report equivalent: every webhook parsed, every message tracked,
debugging tools — i.e. an audit/observability view, not a marketing
dashboard. That maps onto Pilot's audit log + automation log.

**Adopt for Pilot.** (1) The minimal-inbox discipline: list + view +
two dialogs (template, interactive) is enough for a complete inbox;
resist adding CRM panels into the chat view. (2) Template and
interactive composition as dialogs with parameter fields, not as
free text. (3) Failed-delivery indicator on the message itself, not
only in a log. (4) Explicit 24h input restriction with guidance.
(5) Scoped-ID display fallback (name → username → scoped ID →
phone, never a blank row). (6) Observability as audit: every webhook
and send visible in a log the operator can inspect. (7) Polling
honesty: if not realtime, show freshness.

**REJECT for Pilot, and why.** WhatsApp Flows as in-chat mini-apps
(forms, bookings, payments inside chat) — would smuggle commerce and
data collection into the chat; Pilot collects contract data in the
contract flow, not in-chat forms. AI-agent workflows — autonomous AI,
forbidden. Multi-tenant onboarding links ("generate a setup link,
customer connects their Meta account") — one client only; Pilot's
wizard is for the client's own assets, not for onboarding third
parties. Kapso-provisioned US numbers — Pilot uses the client's own
dedicated number, never a provider-provisioned number. Broadcast
delivery-status machinery — marketing, forbidden (the bug-fix note
about broadcast statuses getting stuck is a useful warning about
out-of-order webhooks generally, and Pilot's status-history rule in
§5 is the defence).

**Sources.**
- https://deepwiki.com/gokapso/whatsapp-cloud-inbox
- https://socket.dev/npm/package/@kapso/whatsapp-cloud-api/overview/0.0.8
- https://kapso.mintlify.app/changelog
- https://agentfirst.directory/tools/kapso

---

## 8. Twilio (WhatsApp via Twilio)

**What it is.** Infrastructure, not an inbox. WhatsApp is one channel
of Twilio's Programmable Messaging API (one-way notifications) and
Conversations API (stateful two-way threads), alongside SMS, RCS,
voice and email. There is no ready-made team inbox in the base
product; the agent workspace is a separate product (Flex, contact-
centre pricing). This section is therefore about plumbing and
constraints, not layout.

**Layout hierarchy.** None as an inbox — the "layout" is the Twilio
Console: Messaging > Senders > WhatsApp Senders, Messaging > Templates
(Content Template Builder), Messaging Services, Studio/Functions for
flows, and webhooks configured per number/service. If Pilot ever
needed a Twilio comparison, the lesson is that Console-style
configuration (senders, templates, webhooks as separate admin pages)
is the right home for linking/settings, not the inbox.

**Inbox structure.** Build-your-own, or buy Flex. Incoming messages
arrive as webhooks at a developer-hosted URL; storing conversations,
routing to people and syncing to a CRM is work the customer builds.
That is precisely why Pilot built its own workspace instead of
adopting Twilio: the inbox is the product, not the API.

**Chat display details.** None — Twilio ships no chat UI in the base
product, so no bubble/tick/separator claim can be made for it.

**Automation model.** Studio (visual flow builder) and Functions
(serverless code) for flows; webhook-driven routing in customer code.
Template submission through the Content Template Builder, then Meta
approval. WhatsApp Flows, typing indicators, payment integrations in
supported markets, and AI-agent tooling are listed as advanced
features.

**Templates model.** Created in Twilio's Content Template Builder,
submitted to Meta for approval (typically under 24 hours once the
business is verified; business verification itself is the slower
step). Templates are required to initiate a conversation and outside
the 24-hour window; inside the window, free-form replies are allowed.
Per-message platform fee applies on top of Meta's fees.

**Contacts / reports.** None native to the WhatsApp channel; both are
built by the customer or bought via Flex/CRM integrations.

**Adopt for Pilot.** (1) The separation of concerns: senders /
templates / webhooks as admin configuration, inbox as operations —
Pilot's 7-sub-interface split already does this. (2) The onboarding
warning, stated plainly in Twilio's own flow: a number must be able
to receive a voice/SMS verification code and must not be linked to an
existing WhatsApp account (delete the account first on the standard
flow) — Pilot's wizard should keep the equivalent pre-checks for a
dedicated number, and must NOT copy Twilio's standard flow where it
conflicts with coexistence (see WATI §1 for the coexistence variant).
(3) Webhook-first architecture: every inbound message and status
callback arrives at one URL and is then routed — Pilot's webhook
ingestion already follows this.

**REJECT for Pilot, and why.** Twilio as the messaging provider —
Pilot uses Meta's Cloud API directly, no intermediary markup or
second vendor in the message path. Flex as the workspace — separate
contact-centre product, wrong shape and cost for a closed pilot.
In-chat payments, Flows-based commerce, AI-agent tooling — commerce /
autonomous AI, forbidden. Multi-channel fallback (SMS/voice/email
from one API) — WhatsApp-only scope; fallback channels would break
the single-audit-trail rule.

**Sources.**
- https://timelines.ai/timelinesai-alternative-to-twilio (Twilio vs
  team-inbox comparison, including Flex pricing and coexistence note)
- https://www.whatsapptools.com/tools/business-automation/twilio-whatsapp
- https://www.devopsschool.com/blog/twilio-step-by-step-enable-whatsapp-on-twilio-for-production-use/
- https://www.vipbizexpert.com/blog/whatsapp-business-api-with-twilio.html

---

## 9. Meta WhatsApp Cloud API (the platform itself, not a vendor UI)

**What it is.** The official API all compliant vendors sit on: Graph
API messages endpoint, webhook subscriptions, template management in
WhatsApp Manager, business verification, phone-number registration.
There is no Meta inbox UI to copy; this section records the rules
every inbox above must obey, because Pilot's UI must enforce them
visibly rather than letting operators discover them as failures.

**Message rules that shape the UI.**
- 24-hour customer-service window: opens/resets on each customer
  message; inside it, free-form service messages (text with link
  preview, image, video, audio, document, sticker, location, contacts)
  and interactive messages are allowed; outside it, only pre-approved
  templates may be sent. A successful template send reopens the
  window for 24 hours.
- Template categories (Meta decides the category): Marketing
  (promotions, re-engagement — always charged), Utility (order/account
  updates — charged per delivered message; free inside the window
  until 30 Sep 2026, charged from 1 Oct 2026 per Meta's announced
  change), Authentication (OTP — charged, volume tiers), Service
  (free-form replies inside the window — free until 30 Sep 2026,
  charged at the utility rate from 1 Oct 2026, no volume tiers).
  Customer-initiated messages are always free to receive. The first
  1,000 service messages per month per number and Click-to-WhatsApp
  72-hour free-entry windows are the surviving free allowances.
  Pilot implication: the composer must not promise "free" sends, and
  the 24h badge is a permission indicator, not a billing indicator.
- Interactive messages: reply buttons (up to 3, each with id + title,
  in-window only), lists (up to 10 rows in sections, in-window only),
  CTA URL button, location/address request, Flows, voice-call button.
  Inbound, a button tap arrives as `interactive.button_reply` (id +
  title) and a list choice as `interactive.list_reply` — the id is
  the machine-readable action, the title is what the customer saw.
  Pilot's button handling must therefore log both, and automation
  triggers on button taps must match on id, never on title text
  alone (titles change; ids are the contract).
- Templates: header (text / media / document) + body with numbered
  parameters (`{{1}}`, …) + footer + up to 3 buttons (quick-reply
  with payload per index, URL, call, etc.); language code per
  template; Meta review typically within 24 hours; rejection requires
  resubmission. Pilot's send gate (local + Meta approval) and its
  variable-preview step exist because of this structure.
- Webhooks: subscribe to `messages` (inbound + delivery/read/failed
  statuses), `message_status`, `message_template_status_update`
  (approval changes), plus account/phone-quality alerts. Verification
  is a GET challenge (`hub.mode` / `hub.verify_token` /
  `hub.challenge`); inbound authenticity is HMAC
  (`X-Hub-Signature-256`). Out-of-order status webhooks are a known
  failure mode (see Kapso §7): a later status must never downgrade
  an earlier, further-advanced status.
- Groups API exists for group messages, but Pilot is 1-to-1
  buyer/seller only; group support must not be added casually.
- Voice/video calls stay in the app on coexistence numbers and are
  not part of the Cloud API inbox; Pilot must not promise in-dashboard
  calling.

**Adopt for Pilot.** Everything in the bullet list above is already
Pilot's rule set; the study's contribution is UI wording: (1) the
composer swap text (Chatwoot's literal sentence is a good model);
(2) button taps logged as id + title; (3) status never downgrades;
(4) template send reopens the window — show the window state change
after a template send, so operators learn the rule from the UI;
(5) billing honesty — no "free" label on sends after the Oct 2026
change, and no cost shown unless it comes from a real rate source
(Pilot currently shows no cost; keep it that way rather than
inventing a rate).

**REJECT for Pilot, and why.** Marketing and Authentication template
categories — Pilot authors Utility only. Flows — in-chat forms,
rejected in §7. Calling API — out of scope. Groups API — 1-to-1 only.
Meta's own AI (Business Agent, token-charged from Aug 2026) —
autonomous AI, forbidden.

**Sources.**
- https://developers.facebook.com/docs/whatsapp/cloud-api
  (referenced via SDK docs; direct doc pages were not text-fetched
  in this pass — see limitation note below)
- https://chatmitra.com/blog/whatsapp-cloud-api/
- https://blog.peppercloud.com/whatsapp-api-pricing-everything-you-need-to-know/
- https://www.heltar.com/pricing.html
- https://phone.codeb.io/whatsapp-business.html
- https://dev.to/aisoule/building-a-whatsapp-interactive-button-list-message-handler-in-typescript-28o1
- https://gist.github.com/dani139/16d4c4ea272af8fe75cd28b89ab77ddb

---

## 10. WhatsApp Web itself (chat-display reference only)

**Status of this section.** WhatsApp Web is NOT a path Pilot may use
for messaging (no QR / linked-device / unofficial path — see the
header rules). It is included solely because every vendor inbox
imitates its display conventions, and operators judge any inbox
against it. The details below are the widely documented Web/app
conventions, cross-checked against the inbox descriptions in §1–§9
and against WhatsApp's own help behaviour; where a vendor's own
rendering differs, the vendor section says so.

**Layout hierarchy.** Left rail (chats list + search + filters) |
centre chat pane (header + thread + composer) | optional right
panel (contact info / media / shared files, opened on demand, not
always visible). No separate Contacts/Campaigns/Reports modules —
it is a messenger, not a CRM, and that is why it cannot serve as
Pilot's whole product: it has no assignment, no audit log, no
contract state, no template approval, and no permission model.

**Conversation list rows.** Each row, in order: avatar (photo, else
initial letter) | name (contact name, else profile name, else plain
number) | last-message preview (with a tick prefix when the last
message is yours: grey single = sent, double grey = delivered,
double blue = read, red info icon = failed) | time (clock time
today, "Yesterday", weekday, then date for older chats) | unread
badge (green count; a muted chat shows a mute icon instead of/in
addition to the count; unread chats render bold). Search matches
name, profile name and phone number. "Mark as unread" is a per-chat
reminder for the operator only — it does not remove the sender's
blue ticks and does not notify the other side. "Mark all as read"
clears badges without deleting anything.

**Chat pane.** Header: avatar, name, presence/status line, assignee
or actions menu in team inboxes (in pure WhatsApp Web: search,
call, and menu actions). Thread: oldest at top, newest at bottom,
scroll up to load older messages; date separators ("Today",
"Yesterday", dated) break the thread into days. Bubbles: incoming on
one side, outgoing on the other; each bubble carries body text
(WhatsApp markdown: bold, italic, strikethrough), media preview
(images/video inline, documents as download tiles, voice notes with
a play button), reactions, quoted-reply context (the original message
shown above the reply), and a timestamp + status ticks on outgoing
bubbles. Template messages render as their approved text with
parameter values filled in, followed by their buttons as tappable
rows; interactive reply buttons render as a row of buttons under the
body; list messages render as a body plus a single menu button.
System messages (e.g. window/encryption notices in the app) render
as centred, non-bubble notices — Pilot's internal notes should use
exactly this treatment (centred, visually distinct, clearly
labelled "internal only") so they can never be mistaken for a
customer message.

**Adopt for Pilot (display only).** (1) Row anatomy: avatar-initial
fallback, name → number fallback, last-message preview with tick
prefix, relative time, unread badge, bold-unread. (2) Thread anatomy:
date separators, newest-at-bottom, scroll-up history, quoted replies,
media tiles, voice play affordance. (3) Tick semantics exactly:
sent / delivered / read / failed, with failed in a warning colour and
an explicit retry path — never silently grey. (4) Internal notes as
centred system-style notices, never as bubbles. (5) Template/button
rendering: approved text + filled parameters + buttons as rows, so
the operator sees what the customer saw. (6) Mark-as-unread as an
operator reminder, with the UI stating it does not affect the
customer's ticks.

**REJECT for Pilot, and why.** Using WhatsApp Web / QR / linked
devices as the transport — ban-risk, forbidden, full stop. Copying
WhatsApp Web's lack of assignment/audit/permissions — Pilot exists
precisely to add those. Group chats, disappearing/view-once messages,
live location, broadcast lists — all either disabled under
coexistence, out of scope, or incompatible with an audit trail;
none belongs in Pilot.

**Sources.**
- https://help.phindu.co/crm/inbox.html (Web-modelled inbox description)
- https://docs.corbitaltech.dev/products/whatsapp-qr-login-for-whatsmark-saas-bundle/chat-interface.html
- https://www.lilachbullock.com/does-whatsapp-mark-as-unread-work/
- https://sheetwa.com/blogs/mark-chat-as-unread-on-whatsapp-android-ios/
- https://medium.com/@dhavalbhanderi_13776/keep-the-whatsapp-business-app-and-get-a-team-inbox-how-whatsapp-coexistence-works-f7a39ce30195
  (coexistence limits: no group sync, broadcasts read-only,
  disappearing/view-once/live-location off, calls stay in app,
  20 msg/sec cap, 14-day primary-device rule)

---

## 11. Cross-provider comparison (structure only)

| Area | Common pattern (≥3 vendors) | Pilot's stricter version |
|---|---|---|
| Top level | Left nav: Inbox, Contacts, Templates/Automations, Reports, Settings | Dashboard, Contracts, Inbox & Chat, WhatsApp (7 sub-interfaces), Automation, Users, Audit & Reports, System Settings; phone = top tabs, web = side sidebar, 820px |
| Inbox | List + chat + contact panel; assignment; labels; internal notes; saved replies | Per-contract buyer/seller + general; assignment; labels/tags; internal notes never sent; single composer (text/template/media/quick-reply/internal-note); in-chat search; contact drawer; automation log; macro run; mark-read; handoff/resume |
| 24h window | Composer swaps to template-only with explanation (Chatwoot literal; Kapso restriction) | Badge (open / template-only) + composer swap + template picker; send gate = local + Meta approval |
| Templates | External approval + in-product sync; agents send, admins manage | Author in-product + submit + sync; local vs Meta status separate; Utility + Arabic only; variable preview |
| Automation | Keyword/event triggers → flow builder → assign/handoff | Keyword/first-message/button/contract-event/business-hours/fallback/manual; ask-wait/branch/assign/label/note/task/webhook-out/handoff; loop/cooldown guards; Kill Switch; money steps rejected recursively; delay steps max 2s in webhook |
| Contacts | Full directory + segments + CRM sync | Contract-scoped only; CRUD + CSV import/export + eligibility, no broadcast endpoint |
| Reports | Response/resolution time, agent load, campaign performance | First-response time, audit CSV, reports summary, append-only audit log; no campaign metrics |
| Media | Images/video/audio/documents inline; template media headers | 16MiB cap, sanitised names, Meta media-ID send; media-header template submit still limited (documented) |

---

## 12. Top 15 structural patterns Pilot System should adopt

These are ordered by operator impact, not by vendor. Each names the
source pattern and the Pilot form it should take. None requires a new
vendor, a new stack, or a rule change; all fit the existing
React + Node build and the 820px phone/web split.

1. **List–chat–panel triptych, collapsible by breakpoint.**
   Chatwoot/respond.io/Kapso/Web: list left, chat centre, contact
   panel right on desktop; on phone, list on top, chat below,
   composer pinned, panel as a drawer (never a third column).
   Pilot already does this — protect it in every future redesign;
   never let a new module squeeze the chat pane.
2. **Conversation-row anatomy from WhatsApp Web (§10).**
   Avatar-initial fallback, name → number fallback, last-message
   preview with tick prefix, relative time (today / Yesterday /
   weekday / date), green unread badge, bold-unread, mute icon.
   Missing today: explicit mute handling and the tick prefix on the
   preview — add both; they are the two details operators scan for.
3. **Thread anatomy from WhatsApp Web (§10).**
   Date separators, newest-at-bottom, scroll-up history, quoted
   replies, media tiles, voice play affordance, template text with
   filled parameters + buttons as rows. Internal notes as centred
   system-style notices, never bubbles.
4. **Tick semantics with a failed state that demands action.**
   Sent / delivered / read / failed, failed in warning colour with
   retry; status history accumulates timestamps (OpenBSP §5) and
   never downgrades on an out-of-order webhook (Kapso §7). A failed
   template send must surface its reason where the operator is
   looking — on the message — not only in a log.
5. **The 24-hour composer swap, with words, not just a disabled box.**
   Chatwoot's literal sentence ("You can only reply using a template
   message due to 24-hour message window restriction") is the model;
   Kapso's "restrict input and guide accordingly" is the same rule
   stated worse. Pilot's badge + template picker already does this —
   keep the explanation sentence in the composer itself, and show
   the window reopening after a successful template send (Meta §9).
6. **One-tap triage chips above the list.**
   Chatwoot/respond.io: All / Unread / Mine / Unassigned / By label.
   Pilot has search + filters + "Mine" logic; promote them to
   persistent chips so triage is one tap on a phone, not a filter
   form. "Unassigned" deserves its own chip: it is the queue that
   silently grows.
7. **Assignment semantics: team vs agent, stated in the UI.**
   Chatwoot: team = anyone may pick up, agent = named ownership.
   Pilot's header already shows assignee; add the same distinction
   (unassigned queue vs named owner) and a "reassign if waiting too
   long" manual-ops task (WATI §1), surfaced as a report, not an
   automatic reassignment that could move a live contract chat
   without an audit entry.
8. **Internal notes + @mentions, invisible by construction.**
   Chatwoot's rule (private notes and macro internals invisible;
   only a macro's Send-Message action reaches the customer) should be
   Pilot's stated rule, rendered as §10's centred notices and
   enforced by the existing "internal notes never shown to
   customers" backend split. Add @mention routing inside notes only
   if it writes an audit entry naming the mentioned operator.
9. **Single composer, five modes, one send gate.**
   Pilot already has this (text / template / media / quick-reply /
   internal-note). The vendor lesson is negative: do not split the
   composer into separate "reply" and "template" screens (Kapso's
   dialogs are fine as pickers, bad as separate pages). Keep the
   `/` quick-reply insertion (Chatwoot) and the template dialog
   with parameter fields (Kapso) inside the one composer.
10. **Template record: local status and Meta status, always both.**
    Chatwoot's sync-only model is weaker than Pilot's author + submit
    + sync + dual-status + send-gate model — keep Pilot's, and show
    both statuses in the composer dropdown (already done), in the
    template library, and on the sent message's header. A template
    that is locally approved but Meta-rejected must be
    un-sendable, and the reason visible, not just greyed out.
11. **Rules (automatic) vs macros (manual), labelled as such.**
    Chatwoot's distinction, Pilot's existing split. Every automatic
    rule card should show its Kill Switch state; every macro run
    should write an audit entry naming the operator. Never let an
    automatic rule's card look like a manual action, or an operator
    will "run" a rule that was already running.
12. **Linked-contract state in the chat header, always.**
    respond.io's lifecycle view, translated: the header shows
    assignee + tags + linked contract code + contract state + 24h
    badge together (Pilot already shows most of this). The state is
    not decoration — it is the reason the chat exists, and it is what
    stops an operator from treating a contract chat like a support
    ticket. Add "label on close" (Chatwoot) as the closing habit that
    feeds reports.
13. **Reports that measure the queue, not the customer.**
    respond.io/Chatwoot/WATI agree: first-response time, resolution
    time, agent load, stalled/unassigned counts, longest-open first
    (respond.io Dashboard widget). Pilot has first-response time and
    audit CSV; add longest-open-first ordering to the Dashboard
    widget and a stalled-chat report. Never add customer scoring,
    CX scores shown to customers, or conversion/revenue attribution.
14. **Polling honesty / freshness indicator.**
    Kapso polls conversations every 10s and messages every 5s and
    says so. Pilot does not claim realtime; if it polls or reloads,
    show "last updated" in the workspace so an operator never mistakes
    a stale thread for a live one — especially before sending a
    contract-related reply.
15. **Scoped-identity fallback, never a blank row.**
    Kapso changelog: display business-scoped IDs/usernames alongside
    or instead of phone numbers; phone fields can be nullable.
    Pilot's row rendering must fall back name → username → scoped ID
    → phone, and its send path must stay phone-based. This is a
    small defensive pattern that prevents the most confusing inbox
    bug (a real customer rendered as an empty row).

**Explicitly NOT in the top 15 (rejected everywhere in §§1–10):**
broadcasts/campaigns, catalogs, in-chat payments, Flows-based forms,
AI selling/negotiation, multi-tenancy, third-party developer APIs,
omnichannel inboxes, revenue/conversion reporting, provider-
provisioned numbers, and any WhatsApp Web QR / unofficial transport.
If a future pass proposes any of these, it must name the Pilot rule
it would break and get explicit approval — it cannot arrive as a
"pattern from the study".

---

## 13. Limitations of this study (read before acting on it)

- Vendor UI detail beyond module lists is thin in public sources:
  WATI, respond.io and Interakt bubble rendering (ticks, separators,
  quotes, media treatment) could not be verified from the pages read
  and is therefore NOT attributed to them. Only WhatsApp Web (§10),
  Kapso's code-derived description (§7) and Chatwoot's help centre
  (§4) support display-level claims.
- OpenBSP UI, template, contact and report claims are absent because
  the source read was a backend-patterns article; OpenBSP is an
  architecture reference here, not a UI reference.
- Meta's own documentation pages were referenced via SDK/secondary
  sources in this pass, not fetched as primary doc text; the Graph
  API version and pricing-change dates in §9 (notably the 1 Oct 2026
  service/utility charging change) should be re-checked against
  Meta's current docs before any billing wording reaches the UI.
  Pilot shows no costs today, so this does not block UI work.
- Prices quoted from comparisons are third-party reports, not vendor
  rate cards, and are included only to show product positioning
  (inbox vs campaign vs infrastructure); do not use them for
  budgeting.
- No vendor product was trialled, logged into, or screenshotted in
  this pass (text fetch only). A future pass with live access could
  verify bubble rendering and exact sidebar orders, but must not
  use a live account to send messages or connect a client number
  without explicit approval.

---

## Sources (all URLs verbatim from search/fetch results)

WATI: https://www.wati.io/omnichannel-inbox/ ·
https://www.findmyresponse.com/wati-io-the-whatsapp-automation-tool-thats-like-a-sales-superhero-review ·
https://chatimize.com/reviews/wati/ ·
https://support.wati.io/en/articles/11822421-how-to-connect-your-whatsapp-number-to-wati-via-whatsapp-coexistence-coex ·
https://www.eesel.ai/blog/whatsapp-customer-service-platform

respond.io: http://respond.io/blog/whatsapp-team-inbox ·
https://respond.io/blog/respondio-whatsapp ·
https://respond.io/help/mobile-app/mobile-app-overview ·
https://Respond.io/help/dashboard-reporting/dashboard ·
https://chatimize.com/reviews/respond-io/

Interakt: https://www.techjockey.com/detail/interakt/ ·
https://www.whatsapptools.com/tools/marketing-broadcasting/interakt ·
https://trengo.com/blog/whatsapp-business-api-partners ·
https://dev.to/dawnofgenx/whatsapp-business-api-vs-wati-vs-interakt-which-one-should-you-choose-in-2026-57n

Chatwoot: https://www.chatwoot.net/ ·
https://www.chatwoot.com/hc/user-guide/articles/1754940076-whatsapp-templates ·
https://chatwoot.help/hc/user-guide/en/categories/chatwoot-101 ·
https://devopspack.com/chatwoot-open-source-customer-support-intercom-alternative/

OpenBSP: https://dev.to/cabra/5-supabase-patterns-i-learned-building-an-open-source-whatsapp-platform-2h19 ·
https://openbsp.dev/privacy-policy/

ZeroMsg: https://root.packagist.org/packages/megoxv/zeromsg ·
https://zeromsg.com/en · plus in-repo `docs/zeromsg-study.md`,
`docs/zeromsg-linking.md`, `docs/zeromsg-adaptation.md`

Kapso: https://deepwiki.com/gokapso/whatsapp-cloud-inbox ·
https://socket.dev/npm/package/@kapso/whatsapp-cloud-api/overview/0.0.8 ·
https://kapso.mintlify.app/changelog ·
https://agentfirst.directory/tools/kapso

Twilio: https://timelines.ai/timelinesai-alternative-to-twilio ·
https://www.whatsapptools.com/tools/business-automation/twilio-whatsapp ·
https://www.devopsschool.com/blog/twilio-step-by-step-enable-whatsapp-on-twilio-for-production-use/

Meta Cloud API: https://chatmitra.com/blog/whatsapp-cloud-api/ ·
https://blog.peppercloud.com/whatsapp-api-pricing-everything-you-need-to-know/ ·
https://www.heltar.com/pricing.html ·
https://phone.codeb.io/whatsapp-business.html ·
https://dev.to/aisoule/building-a-whatsapp-interactive-button-list-message-handler-in-typescript-28o1 ·
Meta docs referenced: https://developers.facebook.com/docs/whatsapp/cloud-api

WhatsApp Web (display reference only): https://help.phindu.co/crm/inbox.html ·
https://docs.corbitaltech.dev/products/whatsapp-qr-login-for-whatsmark-saas-bundle/chat-interface.html ·
https://www.lilachbullock.com/does-whatsapp-mark-as-unread-work/ ·
https://medium.com/@dhavalbhanderi_13776/keep-the-whatsapp-business-app-and-get-a-team-inbox-how-whatsapp-coexistence-works-f7a39ce30195

General BSP background: https://emovur.com/blog/whatsapp-business-api/what-is-a-whatsapp-business-solution-provider-bsp ·
https://justcall.io/blog/whatsapp-business-for-teams.html
