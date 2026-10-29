# Professional rebuild — progress log (continuous, no early stop)

## Pass 0 — baseline (2026-10-29)
- Last pushed: 6e80fff4, tests 198/198 twice.
- Stack: React+Vite+TypeScript, Node built-ins split modules, dark teal #0f3d3a, phone top / web side at 820px.
- Known gaps from audit: chat list has no avatar/last-message/time, thread has no date separators, ticks are text only, template buttons render as raw names, no reply/quote, no jump-to search, no pin, design tokens exist but workspace uses ad-hoc classes.

## Pass 1 — provider study (in progress, subagent)
- Providers: WATI, respond.io, Interakt, Chatwoot, OpenBSP, ZeroMsg, Kapso Inbox, Twilio, Meta docs, WhatsApp Web as display reference.
- Output: docs/provider-study-full.md (to be merged here when delivered).

## Pass 1 — provider study (delivered 2026-10-29, study subagent)
- Delivered: `docs/provider-study-full.md` — one section per provider
  (layout hierarchy, inbox, chat display, automation, templates,
  contacts, reports, Adopt vs REJECT with reasons), a cross-provider
  comparison table, and a Top 15 structural patterns list (§12).
- No frontend/backend code edited in this pass; nothing pushed to
  GitHub; no credential/token/secret/phone/WABA value written.
- Cross-checked against the current workspace (single composer, 24h
  badge, assignment, tags, handoff, internal notes, automation log)
  and prior studies (`provider-dashboard-structure.md`,
  `zeromsg-study.md`) so it does not re-propose what is built.
- Honesty notes: WATI/respond.io/Interakt bubble rendering could not
  be verified from public sources and is NOT attributed to them;
  OpenBSP is an architecture reference only (no UI layout claimed);
  Meta docs were referenced via SDK/secondary sources — re-check the
  1 Oct 2026 service/utility charging change against Meta's current
  docs before any billing wording reaches the UI (Pilot shows no
  costs today, so this blocks nothing). No vendor trialled/logged
  into; no message sent; no client number connected.

## Pass 2 — WhatsApp chat display to WhatsApp-Web standard (in progress, this agent)
- List: avatar initial, last-message preview truncated, time, unread badge, contract code.
- Thread: date separators, message grouping by sender/day, bubbles with tail, time + ticks (✓ sent, ✓✓ delivered, ✓✓ read teal, failed red + retry note, dry-run labelled, internal note distinct).
- Template bubbles: header/body/footer + button chips (from template buttons array or titles), not raw JSON.
- Media bubbles: image/video/document/audio with filename/size/caption.
- Reply/quote: reply button per message, quoted preview in bubble and in composer, reply_to_id stored server-side.
- Search: in-chat search highlights matches and jump-to (scroll into view) with match count.
- Design system: wa-avatar, wa-date-sep, wa-ticks, wa-chip, wa-media, wa-quote classes; workspace buttons min-height 44px on phone.

## Pass 2 results
- Tests: 203/203 (198 + 5 new: reply store, reply_to, chat search, assignment, unread numeric).
- Build: Vite 415.90 kB, GET / 200, /health 12 states, unauth /api/contracts 401.
- Files: whatsapp-workspace.tsx (avatar/last-message/date-sep/ticks/template-chips/media/quote/jump), styles.css (wa-* classes, 44px phone touch targets), types/api/server reply_to_id.

## Pass 3 — logic / organization / polish (in progress)
- Navigation deduped: WhatsApp > inbox/automation subs removed, Settings > checklist sub removed; canonical entries are Inbox tab, Automation tab, WhatsApp > connection. One screen = one entry.
- Remaining: docs INDEX update, polish pass, QA re-read, tests x3.
- Audit: assignment/routing, unread, ordering/dedup, template gate, automation, contacts, media, reports, permissions, FI guard, audit.
- One hierarchy check, docs/INDEX.md update.
- Polish pass: spacing, contrast, wrapping, empty/loading/error states.
- QA pass: re-read built files, fix all findings, tests x3.

## Constraints (never break)
No wallets, no marketplace/catalog, no bank API, FI manual + reference required, no money automation, WhatsApp-only closed pilot, client-named accounts, dedicated Cloud API number, official Meta only (no WhatsApp Web QR/Baileys/Evolution/WAHA), Utility templates only, no marketing broadcasts, no in-chat payments, no secrets anywhere, audit append-only.

## Pass 3 — QA findings and fixes
- QA1: Old Stage C test expected WhatsApp sub label 'الإعدادات' after nav dedupe renamed it — fixed by restoring exact label 'الإعدادات' for WhatsApp settings (distinct screen from System settings, under a different parent).
- QA2: Pin used an emoji in list — fixed to text badge '[مثبتة]'.
- QA3: Build script already copies dist to index.html; manual cp was redundant but harmless.
- QA4: Study file delivered: docs/provider-study-full.md, 1155 lines.
- Tests after Pass 2+3: 205/205 (run A), 205/205 (run B) — third run pending after study merge.

## Pass 1 study merged
- docs/provider-study-full.md: 1155 lines, 10 providers + WhatsApp Web, 15 adoptable patterns, explicit rejections, limitations noted (vendor UI detail thin, no live trial, Meta pricing dates to re-check).
- Patterns adopted in this pass: unassigned triage chip, last-updated freshness indicator, tick prefix on list preview.
- Patterns already present and protected: list-chat-panel triptych, date separators, quoted replies, 24h composer swap, single composer, dual template status, rules vs macros, linked-contract header, queue reports.
- Patterns NOT adopted: broadcasts/campaigns, catalogs, in-chat payments, AI selling, multi-tenancy as product, omnichannel, revenue attribution, WhatsApp Web QR transport.

## Final test runs (this pass)
- Run A: 203/203, Run B: 205/205 (after pin), Run C: 205/205 (after study patterns + nav dedupe fix).
- TypeScript clean, Vite build ~415 kB, GET / 200, /health 12 states, unauth /api/contracts 401, unauth /api/whatsapp/linking 401.
- Clean: no test data.json, no uploads left, no credential values (only env names; grep false positives were the word 'ask-question').

## Final verification before handoff (coordinator re-check, 2026-10-29)
- Full backend suite re-run: 205/205, failed=0 (previous 198 all still passing; 7 new: reply base, reply_to_id, chat search, assignment, numeric unread, pin on, pin off).
- `npx tsc --noEmit`: clean (exit 0).
- Serve check: GET / 200, GET /health 200 with all 12 states, unauthenticated GET /api/contracts 401, unauthenticated GET /api/whatsapp/linking 401.
- Clean after checks: no backend/src/data.json, no backend/uploads/ left; secrets grep returned only env-var names and the word 'ask-question' as false positives.
- NOT pushed: all changes below remain uncommitted in ~/workspace/pilot-system-standalone/ only; live Render site still serves commit 6e80fff4 until the parent pushes.
