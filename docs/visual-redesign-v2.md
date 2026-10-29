# Visual Redesign V2 — progress log (2026-10-30)

User verdict that started this round: the previous design is still not right
at all — redo it using the files already produced, changing design,
interaction, sidebar appearance, and everything, professionally, with
skills from GitHub and visual research. NOT pushed to GitHub in this round.

## Pass 1 — Visual research (real sources, not marketing text)

### Chatwoot (Vue frontend, chatwoot/chatwoot)
- Layout: primary navigation rail (icons only, far side) + secondary
  contextual sidebar (account context, inbox list, labels, teams, saved
  views) + conversation list + conversation view + contact panel.
  Secondary sidebar can be toggled off to maximise content space.
- Navigation is permission/feature-aware (Vuex getters), account-scoped.
- Adopted: two-level thinking — one persistent navigation frame, one
  contextual area; permission-gated nav identical in both layouts;
  list / chat / drawer triptych for the workspace (already in Pilot).
- Rejected: a permanent icon-only rail as the ONLY nav — Pilot has 8
  sections with long Arabic labels; an icon-only rail alone hides meaning.
  Hence: full sidebar on web, icon rail only as a collapsed mode.

### OpenBSP UI (matiasbattocchia/open-bsp-ui — read in the previous round)
- React + Vite + Tailwind + Zustand + TanStack; WhatsApp-style chat with
  media and message status, inline template sending, contacts with phone
  validation, templates with variable pills and formatting preview,
  Embedded Signup integrations, org/team roles owner/admin/member,
  stats/billing quota, multi-org switching.
- Adopted: template variable pills and formatting preview pattern,
  message-status ticks, contact validation thinking.
- Rejected: multi-org switching and billing/quota UI — Pilot is a closed
  pilot for one client, no marketplace, no billing inside the system.

### Kapso WhatsApp Cloud Inbox (gokapso/whatsapp-cloud-inbox — previous round)
- Next.js, WhatsApp-Web-style inbox: template messages with header/body/
  button parameters, interactive messages up to 3 buttons, media,
  24h enforcement, failed indicators, polling (conversations 10s,
  messages 5s) rather than websockets.
- Adopted: WhatsApp-Web list/chat structure, 24h badge, failed/dry-run
  ticks, template bubbles as buttons — all already in Pilot and kept.
- Rejected: polling as a design claim — Pilot does not claim live polling;
  refresh is manual/reload-based.

### ZeroMsg (megoxv/zeromsg — README and root listing only, previous round)
- Laravel/TypeScript, templates/campaigns/inbox/API. Too new/small
  (21 stars) to copy internals from; no ZeroMsg internals beyond the
  README are claimed here.
- Adopted: nothing visual beyond the earlier dashboard-structure study.
- Rejected: campaigns/broadcast UI — forbidden by the pilot scope
  (WhatsApp-only customer interface, Utility templates, no broadcast).

### shadcn / professional admin sidebars (web research this round)
- shadcn-admin pattern: fixed panel, expanded 256px (w-64), collapsed
  56px (w-14) icon rail, width transition, brand header (logo + name +
  subtitle) with text collapsing smoothly, collapse toggle as a round
  button, tooltips opening away from the rail (in RTL: to the left of a
  right-side rail), badges on nav items (e.g. Tasks "3"), active item as
  a filled pill, group labels in small uppercase text.
- FlyCommerce/shadcn variant: collapsible to icons with the toggle in the
  top bar, sheet below 768px (Pilot deliberately does NOT use a sheet:
  phone gets scrollable top tabs, never a drawer, per the user's
  correction and the broken-drawer history).
- Adopted: 272px expanded / 76px collapsed rail (slightly roomier than
  256/56 for Arabic labels), width 200ms ease, brand header, uppercase
  small group labels, solid active pill, badges from real data only,
  native tooltips on collapsed icons, footer user card.
- Rejected: off-canvas sheet/drawer on phone; hamburger-opened drawers;
  faint-tint active states; emoji or tiny icons.

## Pass 2 — New sidebar spec (implemented)

Component: `frontend/src/sidebar.tsx` — ONE component, not duplicated
markup. App.tsx only passes data (me, main, visible, unread, openTasks,
collapsed, callbacks).

- Web/desktop (>= 820px): fixed full-height panel at RTL inline-start
  (right side), `position: sticky; top: 64px; height: calc(100vh - 64px)`,
  width 272px expanded, 76px collapsed, `transition: width .2s ease`.
- Brand header: gradient shield mark (26px SVG) + "Pilot System" +
  subtitle "نظام إدارة العقود والمعاملات" — never text alone.
- Groups (small caps, 11px, letter-spaced): العمل اليومي /
  القنوات والأتمتة / الإدارة والمراجعة.
- Nav items: 21px SVG icons, label (ellipsis on long Arabic labels),
  badge slot — inbox unread (real sum) and contracts open-task count
  (real count); collapsed mode shows a red dot instead of a number.
- Active: solid bright-teal (#14b8a6) pill, white bold text, 4px white
  accent bar on the inline-start edge, soft shadow. Hover: soft white
  wash + icon scales to 1.12. Focus: visible outline (global
  focus-visible rule). Press: translateY(1px) / scale(.94) on toggles.
- Collapsed mode: icon-only 76px rail, labels/group titles/user text
  hidden, native `title` tooltips + aria-labels on every icon, collapse
  button toggles and persists in localStorage (`ps:sidebar-collapsed`).
  Frontend-only state — no backend test needed.
- Footer: fixed-controls note + user card (avatar initial, name, role,
  logout button). Logout never floats in the page body or topbar again.
- Phone (< 820px): sidebar is NOT rendered as a drawer at all
  (`display: none !important`); sticky slim header (brand mark + name)
  + horizontally scrollable pill tab bar (no wrap, scroll-snap, hidden
  scrollbar, end-fade scroll hint), active = solid teal pill, and the
  active tab is scrolled into view on every navigation change.
- Permission gating identical in both layouts: both derive from the same
  `visibleNav` (hasSection) list.

## Design system (applied in styles.css)

- Tokens: `--teal-dark #0f3d3a`, `--teal #0f766e`,
  `--teal-bright #14b8a6`, `--page #eef2f5`; radius scale 10/14/18/22px;
  shadow scale (card / lift); spacing via existing 8px-based rhythm.
- Typography: system Arabic font stack first
  ("IBM Plex Sans Arabic", "Noto Sans Arabic", "Segoe UI", Tahoma,
  system-ui) — no webfont dependency that can block rendering; Latin
  stack (Inter, Segoe UI) for "Pilot System". Type scale: page 28px,
  card 21px, section 16px, label/muted 13px. No ad-hoc font sizes added.
- Motion: sidebar width 200ms ease, nav hover 200ms, tab switch 200ms,
  card entrance `rise` 280ms ease (fade + 8px slide, once on mount, no
  loops), buttons press states, `prefers-reduced-motion` disables all.
- Touch: every phone interactive element >= 44px (tabs 44px, composer
  buttons 44px, sidebar links 48px).
- Logical properties: margin/padding/border use inline-start/end
  throughout the new sidebar/topbar/chat rules, so RTL is by
  construction, not overrides.
- Cards/tables/forms: one radius/shadow scale, consistent dashed empty
  states, `.skeleton` shimmer loading blocks (used on the auth-check
  screen), plain-Arabic error states (unchanged wording).

## Pass 3 — Applied everywhere

- Dashboard, contracts, inbox/workspace, templates, automation,
  contacts, media, users, audit, settings: all inherit the new tokens,
  type scale, radius/shadow scale and entrance motion via shared CSS —
  no per-section ad-hoc styles were added.
- Login: brand header now uses the same dark-teal gradient as the
  sidebar brand mark, so login matches the new sidebar/header brand.
- WhatsApp chat restyle (structure unchanged from the previous round):
  chat thread now has a subtle dotted WhatsApp-like background tint
  (#eef0e6), white incoming bubbles / pale-teal outgoing bubbles with
  proper tail corner radii, 78% max-width, stronger shadow; composer is
  a rounded (22px) light-grey panel with a pill-shaped input, rounded
  pill mode buttons with tooltips (نص / قالب / وسائط) and a send button
  with a tooltip. List/chat/drawer, ticks, date separators, template
  buttons, media tiles, reply/quote, 24h badge and contact drawer are
  unchanged in behaviour.

## Pass 4 — QA (this round)

- 390px: no sidebar, top tabs only, scrollable pills, no horizontal
  overflow expected (tabs are nowrap in an overflow-x container; tables
  scroll inside .table-wrap). Verified by CSS review, not a real device.
- 820px: sidebar appears (272px), top tab bar hidden, no drawer
  leftover (no burger, no backdrop element in use).
- 1440px: full sidebar + content; chat grid 320px list / 1fr chat /
  300px drawer when open; collapses to one column <= 1024px.
- Collapsed: 76px rail, icons + native tooltips, red dot badges, chat
  area expands (flex layout). Collapse persists across reloads.
- Active/hover/focus: solid pill + accent bar, wash + icon scale on
  hover, global focus-visible outline, press states on buttons.
- Long Arabic labels: sidebar labels ellipsis, top tabs nowrap with
  scroll, table cells wrap/vertical-top.
- Badges: real numbers only (unread sum, open-task count); zero hides
  the badge entirely.
- Permission gating: sidebar and phone tabs share `visibleNav`.
- Second polish pass fixes applied in this round: (1) phone header
  brand mark added after review — without it the brand name vanished on
  phone once the topbar brand moved into the sidebar; (2) page-crumb
  hidden on phone so the slim header does not wrap; (3) subnav sticky
  offset corrected 82px -> 72px for the new 64px header; (4) topbar
  sticky offset corrected 74px -> 64px everywhere.
- NOT verified on a real device: the user's own phone/desktop test is
  still decisive (first phone top-tab tap, desktop sidebar collapse,
  login, contract flow).

## Files changed (this round, not pushed)

- `frontend/src/sidebar.tsx` (NEW, one sidebar component)
- `frontend/src/App.tsx` (uses Sidebar, collapsed state + persistence,
  active-tab scroll-into-view, slim topbar, phone brand mark, skeleton
  auth screen; old inline sidebar markup removed)
- `frontend/src/styles.css` (V2 design system, sidebar, topbar, phone
  tabs, chat background/bubbles, composer, type scale, motion, skeletons)
- `frontend/src/whatsapp-workspace.tsx` (composer button tooltips only)
- `frontend/index.html` (rebuilt single-file bundle, 423,904 bytes)
- `docs/visual-redesign-v2.md` (this log)

## Tests and checks (this round)

- TypeScript: `npx tsc --noEmit` clean (before and after final rebuild).
- Vite build: succeeds; bundle 423,904 bytes; rebuilt `index.html`
  contains the new sidebar classes.
- Backend suite: 205/205 PASS, run twice, then re-run after the final
  frontend-only polish edit (frontend changes do not touch backend
  behaviour; all 205 previous tests still pass).
- Serve check (local, port 3101): GET / -> 200 (423,904 bytes),
  unauthenticated GET /api/contracts -> 401, GET /health -> 200 with
  all 12 states in order.
- Cleanup: test data file removed, no uploads directory left behind.
- Secret grep: no credential values in changed frontend files or this
  log (only env-var names in pre-existing docs, no values).

## What remains (not done in this round)

1. Parent verification, then GitHub push to ahmedassem123x-web/Pilot-System
   (private, main) — Render auto-deploys on push; verify the live URL
   shows the new sidebar/workspace.
2. Real-device test by Ahmed (decisive): phone top tabs, desktop
   sidebar + collapse, login, contract flow, template send, file upload.
3. Meta linking LAST, in the client's own name only (see master prompt
   section 8); no token in chat or repo, ever.
4. PostgreSQL persistence, daily backup, uptime alert before real data.
5. 3-round real testing; FI manual agreement; handover.
