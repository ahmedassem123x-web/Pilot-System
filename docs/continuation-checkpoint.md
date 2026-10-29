# Continuation Checkpoint — Pilot System

## Dedupe fix for real (2026-10-30, NOT pushed yet — local only)
- The previous round's claim was WRONG: `App.tsx` line 279 still rendered a
  pill row (`btn-row subnav`) for every non-inbox page, and the user's live
  screenshot of WhatsApp Overview proved it (top main tabs PLUS a pill row
  with all 16 WhatsApp sections). This fix deletes it globally.
- DELETED: the pill row JSX in `frontend/src/App.tsx`, the `.subnav` CSS
  rules in `frontend/src/styles.css` (including the 1024px override).
  Grep proof: `grep -rn "subnav" frontend/src/` returns 0 occurrences
  (source only; the rebuilt bundle also contains 0), and the new backend
  test below enforces it.
- REPLACED by ONE navigation source only:
  - Web (≥820px): the sidebar, now with EXPANDED subsections under the
    active main tab only (`side-subs` in `frontend/src/sidebar.tsx`,
    permission-gated by App via `activeSubs`, hidden when collapsed).
  - Phone (<820px): ONE compact dropdown at the top of page content,
    `section-select` labelled "قسم {main label}" (e.g. "قسم واتساب"),
    CSS-hidden on desktop, 44px select. No pill row, no second tab row.
  - No separate section-link list was added on overview pages: that would
    be a THIRD appearance of the same labels (sidebar + list), i.e. the
    exact duplication the user complained about. Sidebar (web) +
    dropdown (phone) is the single source.
- All 16 WhatsApp sections remain reachable (overview, insights,
  conversions, lists, segments, tags, contacts, auto-replies, designer,
  user-input, handoff, templates, chat-widget, connection, media,
  settings), plus all other mains' subs, with identical permission gating.
  No route or permission changed. Triptych, composer buttons, 7-step
  wizard, and 4 PDF types are untouched.
- Tests: 247/247 twice (was 246; +1 new check "dedupe fix: pill row gone
  everywhere, one section control only"). TypeScript clean, Vite build
  succeeds, rebuilt `frontend/index.html` (488.13 kB, contains
  section-select/side-sub, 0× subnav). Serve: GET / 200, /health 200 with
  all 12 states, unauthenticated /api/contracts 401, /api/whatsapp/linking
  401. Test data/uploads deleted, secrets grep clean (no credential values).
  Breakpoints (code-checked, not live-device): 390px dropdown + scrolling
  tabs + tables inside cards, no overflow; 820px sidebar appears, dropdown
  hidden, expanded subs visible; 1440px full layout, collapsed rail hides
  subs. Real-device test by the user remains decisive.
- Files changed this fix: `frontend/src/App.tsx`, `frontend/src/sidebar.tsx`,
  `frontend/src/styles.css`, `frontend/index.html`, `backend/src/test.js`.

## Last completed work (NOT pushed yet — local only)
- Date: 2026-10-30 (continuation round, after commit 9171d177).
- Continuation prompt stages §3–§12 executed locally in `~/workspace/pilot-system-standalone/`:
  1. **Dedupe (no-duplication-navigation):** phone top tabs are MAIN tabs only
     (dashboard / contracts / inbox / whatsapp / automation / users / audit / settings)
     — subsections are reached once via the single subnav row, never as extra phone
     tabs. WhatsApp page no longer renders EmbeddedSignup as a separate card above
     the wizard nor a separate Webhook status card: Embedded Signup now sits INSIDE
     the one 7-step wizard card. Page crumb shows the main section only. Cards
     scroll horizontally inside themselves (`main { overflow-x: hidden }`), so no
     table can cut off the page at 390px.
  2. **WhatsApp composer:** one rounded input bar with buttons BESIDE it —
     image, video, document, audio, template, quick-reply (/), internal-note,
     send. Tapping the input focuses it for typing (keyboard opens on phone);
     Enter sends. Attach buttons open the file picker filtered to allowed media
     types (max 16 MiB, server-enforced). Triptych, 24h badge, template buttons,
     media bubbles, reply/quote, internal notes as system notices all kept.
  3. **Linking simplified:** ONE 7-step wizard (server-driven
     `GET /api/whatsapp/status` → `wizard_steps`, in the client's name, no secret
     value ever shown, no token input anywhere). Embedded Signup is a step inside
     that wizard, not a separate list. The old 10-step checklist endpoint only
     redirects to `/api/whatsapp/linking`.
  4. **Contracts as PDF — FOUR types:** goods_sale (بيع بضاعة, with quantity +
     specifications), service (تقديم خدمة, with service_duration), supply
     (توريد, with delivery_stages), general (تنفيذ صفقة عام). Each PDF carries
     code, type title, state, parties, product/service, amount/currency,
     delivery point, type fields, creation date, version, SHA-256 fingerprint,
     signed copies, audit summary, manual-FI note. New endpoints:
     `GET /api/contracts/:id/signing` (sent / buyer_signed / seller_signed /
     both_signed + files) and `POST /api/contracts/:id/send-pdf` (idempotent —
     second call returns `already: true`). Flow: send PDF → party fills/signs →
     upload signed copy back as a separate version (`buyer_signed` /
     `seller_signed`) — the original is locked and never replaced. Invalid
     `contract_type` is rejected (400). Demo contract is type `general`.
  5. **Colour / performance / icons:** §7 system kept everywhere (dark teal
     #0f3d3a, page #eef2f5, SVG icons 21px in nav). Vite single bundle rebuilt:
     `frontend/index.html` is now 487,143 bytes (single file, no blocking
     webfonts, no new heavy libraries). Composer buttons are ≥40px targets
     (send 44px).
  6. **Smart tools:** quick replies (button + `/` dropdown), templates picker in
     the composer, in-chat search with jump, one-click assign/pin/handoff/read
     and details drawer from chat (all pre-existing, verified still present in
     the triptych).
- **Tests: 246/246 twice** (was 232; +14 new checks: invalid type 400, 4 types
  created, goods PDF bytes, signing initial state, send-pdf first + idempotent
  second call, one-signed, both-signed, signing 404, signing 401, PDF 401).
  One old check was fixed, not weakened: "webhook never creates a contract
  automatically" now compares contract count before/after the general inbound
  instead of assuming exactly 1 contract exists (the 4 new type contracts broke
  the old assumption; the intent — webhook creates zero contracts — is intact).
- **TypeScript clean** (`npx tsc --noEmit`, no errors). **Vite build succeeds**
  and `frontend/index.html` was regenerated (contains the new composer class
  and the 4 type names).
- **Serve checks:** GET / 200 (487,143 bytes), GET /health 200 with all 12
  states, unauthenticated GET /api/contracts 401, unauthenticated
  GET /api/whatsapp/linking 401. Test data and uploads deleted afterwards;
  secrets grep clean (env names only, no values in any file).
- **Breakpoints (code-checked, not live-device):** 820px sidebar/top-tab switch
  intact; 390px one-column stats, tabs scroll, tables scroll inside their card;
  composer wraps at ≤520px with the input on its own row.
- **Scope kept:** V1.2 only — no wallets, no marketplace/catalog, no bank API,
  money with external FI under manual coordination, no payment confirmation
  without FI reference, dispute blocks financial steps, cancellation closes
  never deletes, audit append-only, closed invitation-only pilot, WhatsApp-only
  customer interface, official Meta Cloud API only (no WhatsApp Web QR),
  Utility templates only, no marketing broadcasts, no AI selling (draft-only),
  no secrets anywhere.

## Files changed (local, unpushed)
- `backend/src/server.js` — CONTRACT_TYPES, contract_type + type fields on
  create/amend/version snapshot, PDF type title + type lines, signing + send-pdf
  endpoints, demo contract type.
- `backend/src/test.js` — 14 new checks + the webhook-count fix above.
- `frontend/src/App.tsx` — main-only phone tabs, simplified active key, no crumb.
- `frontend/src/api.ts` — createContract type fields, contractSigning,
  sendContractPdf, uploadContractFile.
- `frontend/src/types.ts` — CONTRACT_TYPE_AR, contract type fields.
- `frontend/src/views.tsx` — contract form type select + type fields, list
  type column + table-wrap, detail signing flow section, wizard dedupe
  (EmbeddedSignup inside wizard card, Webhook card deleted), audit table-wrap.
- `frontend/src/whatsapp-workspace.tsx` — composer bar with beside-input
  buttons, hidden file input, quick-reply toggle, Enter-to-send.
- `frontend/src/styles.css` — composer bar styles, card overflow, main overflow.
- `frontend/index.html` — rebuilt single-file bundle (487,143 bytes).

## Exact next step (in order — do NOT skip)
1. **Push** these local changes to private repo `ahmedassem123x-web/Pilot-System`
   (main), append the new commit SHA + path list to
   `~/workspace/pilot-system-standalone.muse-github-snapshot-sync.json`,
   verify by re-reading the repo's commit list. Render auto-deploys on push;
   wait for the new deployment, then verify the live URL shows the new work.
   NOTE: push UTF-8 files only — the DejaVu font stays as base64 text
   (`DejaVuSans.ttf.b64`), never a binary TTF.
2. **Real-device test by Ahmed (decisive):** first phone top-tab tap, desktop
   sidebar + collapse, triptych list→chat→details, demo conversation + demo
   contract + PDF download, flow canvas, login, contract flow, template send,
   file upload, composer buttons beside the input, all 4 PDF types, signed
   re-upload flow. Do not claim the design meets his bar until he confirms.
3. **Meta linking LAST, in the client's own name only:** Business verification,
   WABA, dedicated Cloud API number + OTP, display name, System User permanent
   token, webhook subscription (messages / message_status /
   message_template_status_update), then `WHATSAPP_*` env vars + `APP_BASE_URL`
   in Render → Redeploy → Test Token → test message → template approval
   (typically up to 24h). **No token in chat or repo, ever.** Open question
   first: is the Meta account he said is ready his own account for testing, or
   the final client's account? For the final client it must be the client's
   from the start.
4. Before any real client data: PostgreSQL persistence migration (backend
   still stores data in a container file), 3-round real testing on the
   deployed version, client acceptance (9-step cycle) + handover + training,
   FI manual agreement.

## Still known limitations (never claim otherwise)
- No live Meta test yet (mocked tests only); button payload shape to confirm
  against Meta docs before the first real send; delay steps max 2s in webhook;
  media-header template submit may need a media session; no live-device test
  of this round yet.
