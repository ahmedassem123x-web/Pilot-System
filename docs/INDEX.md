# Pilot System — Docs Index (single index, no duplicated docs)

This index is the only place that lists the docs. Each document below is
the single source of truth for its topic; other docs link here instead of
repeating it.

- [state-machine.md](state-machine.md) — the 12-state contract machine,
  transitions, FI-reference rule, and clause fingerprint. Authoritative
  for contract states; the backend implements it in `backend/src/contracts.js`.
- [meta-linking.md](meta-linking.md) — Meta Cloud API linking: Embedded
  Signup and the manual env-var path, webhook fields, and the 7-step wizard.
  Authoritative for linking; the wizard itself is server-driven
  (`GET /api/whatsapp/linking`).
- [meta-audit.md](meta-audit.md) — audit of the earlier Meta story: what
  was misleading, what was fixed (template approval gate, webhook HMAC,
  inbox replies). Historical record; do not re-apply its old fixes.
- [zeromsg-study.md](zeromsg-study.md) — study of the ZeroMsg provider
  project: features worth matching, and what was deliberately NOT copied
  (WhatsApp Web QR, broadcasts, marketing).
- [zeromsg-linking.md](zeromsg-linking.md) — ZeroMsg-style linking notes
  (Embedded Signup tested-not-persisted). Superseded in part by
  meta-linking.md for the canonical flow; kept for the token-handling detail.
- [zeromsg-adaptation.md](zeromsg-adaptation.md) — how ZeroMsg features
  were adapted to this contract system (automation engine, media by media
  ID, contacts as a contract-scoped address book, never an audience).
- [provider-dashboard-structure.md](provider-dashboard-structure.md) —
  provider dashboard structure comparison (WATI / respond.io / Interakt /
  Chatwoot / OpenBSP / ZeroMsg) that shaped the WhatsApp workspace layout.

Hard constraints (never duplicated in code comments beyond a pointer):
no internal wallets/balances, no marketplace, no matching, no in-chat
payments, no automated bank API, money with an external financial
institution under manual coordination, payment confirmation only with an
FI reference, no automation/AI step may change a money state, WhatsApp
only for customers, closed pilot by invitation/manual approval, production
accounts in the client's name, dedicated Cloud API number, official Meta
Cloud API linking only (never WhatsApp Web QR or unofficial tools),
Utility templates only, no secrets in code/repo/chat (hosting env vars
only), append-only audit with the real user as actor.
