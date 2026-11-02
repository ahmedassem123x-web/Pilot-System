# Pilot System v3.1 — Rebuild (Sprints 0–5)

Governing stack (v3.1, fixed): Node.js 20 LTS + TypeScript 5 + NestJS 10
backend, PostgreSQL 16 + Prisma 5 database, Redis 7 + BullMQ 5 queues,
React 18 + TypeScript + Vite operations panel, direct Meta WhatsApp
Business Platform Cloud API, Docker + Docker Compose deployment.
Money stays with an external financial institution under manual,
documented coordination. The system NEVER moves money, never accepts
by silence/time/job, and has no Control Tower in any form.

## Sprint 4 + Sprint 5 status (2026-11-02 — read this first; the rest of this file is Sprint 0-era)

Sprint 4 (PB-13, PB-26, PB-27) and Sprint 5 (PB-28, PB-29) are
delivered in this tree — see `docs/sprint-4-report.md`,
`docs/deployment-checklist.md`, and `docs/compliance-report-v3.1.md`
for the full reports. Headline results:

- Sprint 3's REFUND_PENDING Guard bug is FIXED (a rejected settlement
  attempt while DISPUTED no longer poisons a later legitimate refund),
  with a regression test proving the full sequence on one transaction.
- Full WhatsApp inbox triptych (list | chat | details; phone =
  list → chat → drawer) with backend read endpoints + triage metadata
  (assignment, tags, internal notes that are never sent).
- All 11 critical tests pass TWICE, plus a negative test for every
  §1.1 prohibition. Full suites TWICE: backend 185/185 (24 suites),
  frontend 15/15. Both lints clean, both builds clean. Live boot
  check: /health 200, inbox 401 without token, webhook 403/200.
- UAT script + operator runbook delivered. UAT minutes are UNSIGNED
  until Ahmed signs — no signature is claimed, and no UAT session
  has been run.
- Delivery package (CORE PROMPT §14.2) present in this tree: source,
  schema, migrations, config without secrets, docs, runbooks,
  access-data handover note (names only), OSS licence list
  (`docs/oss-licences.md`, generated from the installed trees).

### Honest unverified list (do NOT claim these)

Live Postgres apply; Prisma Store implementation; live Redis/BullMQ;
live Meta sends; live Postgres restore; Docker Compose up; GitHub
Actions run; Node 20 behaviour (local Node is 24.22.1); UAT execution
+ signature; staff training delivery; GitHub push; Render deploy.
All backend tests run on the labelled in-memory Store double, not
Prisma/Postgres. `npx prisma@5 validate` and `generate` both exit 1
in this environment (no validation output) — re-run where registry
access works before any Postgres-backed deploy. No push and no
deploy were made by this work.

## Sprint 3 status (2026-11-02 — the rest of this file is Sprint 0-era)

Sprint 3 is implemented on top of Sprint 2 (see `docs/sprint-3-report.md`
for the full report, and `docs/checkpoint.md` for the running log):
HTTP controllers for transactions, contracts, evidence, coordination,
disputes, settlement, delivery/handover events, audit (read-only),
users, templates, and messages — all behind JWT auth + backend
permission Guards; WhatsApp webhook with HMAC verification,
idempotency, and status monotonicity (dry-run transport only — no
real Meta send); the ONE staff-only React operations panel; the
configurable payment-instruction voucher; four separate financial
references; manual verification path; dispute freezing; separation of
duties wired through HTTP; an in-memory/test queue transport
(reminders, escalations, and async webhook processing ONLY — live
Redis behaviour is UNVERIFIED here); file metadata + short-lived
signed links; and a backup/restore runbook with a unit-tested
snapshot round-trip. All tests still run against the in-memory test
double: live PostgreSQL, live Redis, and live Meta behaviour remain
UNVERIFIED in this environment (no Docker, no Postgres, no Redis, no
Meta account here). No GitHub push, no deploy.

## What runs (Sprints 0–5 — supersedes the Sprint 0 description below)

- Backend: NestJS 10 app — `GET /health` → `{"ok": true}` plus the
  full transaction/contract/evidence/coordination/dispute/settlement/
  audit/users/templates/messages/inbox API, all behind JWT auth +
  backend permission Guards, with the 15-state machine and its
  Guards enforced in `transactions.service.ts`.
- Frontend: React 18 + Vite staff-only operations panel (Lifecycle,
  Evidence, Verification, Institution, Settlement, Disputes,
  Handover, Inbox triptych, Messages, Audit, Users).
- `docker-compose.yml`: PostgreSQL 16, Redis 7, backend, and frontend
  services with named volumes (`pilot-system-pgdata`,
  `pilot-system-redisdata`) and healthchecks. All secrets are `${VAR}`
  placeholder references only — see `.env.example`. The compose file
  is file-reviewed and YAML-parsed; `docker compose up` has NOT been
  run here (no Docker binary).

## What does NOT exist yet (plainly)

- No Prisma Store implementation (backend runs on the in-memory test
  double); no live Postgres apply; no live Redis/BullMQ transport;
  no real Meta transport (dry-run only); no real object storage.
- No UAT session run or signed minutes; no training delivered.
- No push to GitHub and no deployment to any host. None was done by
  this work, and none should be done before the Sprint Acceptance
  Gate (CORE PROMPT §5.5) plus Ahmed's separate explicit written
  authorisation.

## Local development (without Docker)

Prerequisites: Node.js 20 LTS (see "Honest limits" below about the local
Node version used to verify this scaffold) and npm 10+.

```bash
# Backend — from the repository root
cd backend
npm ci
npm run dev        # starts on port 3000 (or $PORT)
# Check it:
curl http://localhost:3000/health
# Expected: {"ok":true}

# Frontend — from the repository root, in a second terminal
cd frontend
npm ci
npm run dev        # starts on port 5173
# Open http://localhost:5173
```

Other useful commands, in each of `backend/` and `frontend/`:

```bash
npm run lint       # backend: ESLint; frontend: ESLint
npm test           # backend: Jest; frontend: Vitest
npm run build      # backend: tsc to dist/; frontend: tsc + Vite build
```

## Docker Compose (full stack, from zero)

Prerequisites: Docker + Docker Compose on the machine that runs this.
Copy an environment file first — never commit real values:

```bash
cp .env.example .env
# Edit .env and fill in values locally. It is git-ignored.
# Development / Staging / Production each get their OWN .env file with
# their OWN values; see .env.development.example and
# .env.production.example (names only, no values).

docker compose up --build
# Backend:  http://localhost:3000/health  -> {"ok":true}
# Frontend: http://localhost:5173
docker compose down            # stop, keep volumes (data survives)
docker compose down -v         # stop AND delete volumes (data is lost)
```

## Environments

Development, Staging, and Production are SEPARATE. Each environment has
its own `.env` file (never committed), its own database, and its own
credentials. Environment files in this repository contain VARIABLE NAMES
ONLY — never values, never tokens. `.env.example` is the full list;
`.env.development.example` and `.env.production.example` carry the same
names with the separation note for their environment.

## CI

`.github/workflows/ci.yml` runs, for both backend and frontend, on every
push and pull request: `npm ci`, `npm run lint`, `npm test`, and
`npm run build`, on Node 20. A failing CI blocks merge — that blocking is
enforced by GitHub branch protection, which the repository owner must
enable on the protected branch (require status checks to pass before
merging). The workflow file alone does not turn branch protection on.

## Honest limits — what was verified here, and what was not

- The scaffold author's machine in this session runs Node v24.22.1 and
  npm 10.9.4, NOT the pinned Node 20. The code, Dockerfiles, Compose file,
  CI, and `engines` fields all pin Node 20 LTS per v3.1; local verification
  below was done on Node 24, so Node-20 behaviour is verified by CI/Docker,
  not by the local runs in this session. `npm ci`/`npm install` on Node 24
  prints an engines warning but proceeds (engines are not enforced
  unless `engine-strict` is set).
- This machine has NO Docker binary installed, so `docker compose up`
  could NOT be run here. The Compose file, Dockerfiles, volumes, and
  healthchecks are written but UNVERIFIED by an actual container run.
  They must be verified on a machine with Docker before Sprint 0 is
  accepted as "runs from zero" via Docker.
- This machine has NO local PostgreSQL server, so no live database
  connection was tested. The backend does not connect to any database in
  Sprint 0, so this does not block the skeleton — but it means the
  PostgreSQL 16 service in Compose is also unverified here.
- GitHub Actions could NOT be run from this machine. CI is defined and
  must go green on the first real push/PR; it has not been observed green
  here.
- No GitHub push, no Render deploy, and no deletion were performed by
  this task, per its instructions.

## Layout

```
pilot-system-v31/
  backend/                 NestJS 10 skeleton (src/main.ts, app.module.ts,
                           app.controller.ts with GET /health only,
                           app.service.ts, one controller spec)
                           NOTE: backend/prisma/ is NOT part of this
                           scaffold task — it is owned by the Sprint 1
                           worker and may appear alongside this scaffold.
  frontend/                React 18 + Vite skeleton (App.tsx only)
  docker-compose.yml       postgres:16, redis:7, backend, frontend
  .env.example             variable names only
  .env.development.example variable names only (Development)
  .env.production.example  variable names only (Production)
  .github/workflows/ci.yml lint + unit tests + build, Node 20
  docs/                    pre-existing (product backlog — not touched)
```
