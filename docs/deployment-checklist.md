# Deployment Checklist — Pilot System v3.1 (Sprint 5, PB-28)

For the machine that WILL run the deployment. This checklist does
NOT claim a deployment has happened: no Docker run, no live Postgres,
no live Redis, and no Render deploy were performed in this
environment (see §6). Work through it in order; do not skip the
preconditions.

## 0. PRECONDITIONS — all must be true before any deploy step

- [ ] Ahmed's WRITTEN acceptance of Sprints 0–4 (sprint acceptance gates, CORE PROMPT §5.5). No push and no deploy before the gate passes.
- [ ] A written agreement with the financial institution exists (CORE PROMPT §19, item 1). Until then: NO real financial operation, test data only.
- [ ] The final client-owned Meta account, WABA, and number are ready (PB-14). Development uses test accounts/numbers only.
- [ ] The Prisma Store implementation exists (see §6, blocker B1). The current backend runs on the InMemoryStore test double; deploying that double to production would LOSE ALL DATA on restart. Do NOT deploy the test double as production.
- [ ] The Redis-backed queue transport exists (blocker B2). The current queue is in-memory/test only.
- [ ] The real Meta transport swap is implemented (docs/whatsapp-real-transport-swap.md) and tested on the test account (blocker B3).

## 1. Machine requirements (CORE PROMPT §6 stack, fixed)

- Node.js 20 LTS, PostgreSQL 16, Redis 7, Docker + Docker Compose (for the compose path) OR the equivalent managed services.
- Environment: Development, Staging, Production SEPARATE. Never share one database across environments.

## 2. Environment variables — NAMES ONLY (values in the machine's secret store, never in files, chat, or commits)

- `DATABASE_URL` — PostgreSQL connection for Prisma.
- `REDIS_URL` — Redis 7 connection for BullMQ.
- `JWT_SECRET` — backend JWT signing (no fallback, no default).
- `WHATSAPP_APP_SECRET` — webhook HMAC secret.
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN` / `WHATSAPP_VERIFY_TOKEN` — webhook subscription verification (the code accepts the former, falling back to the latter).
- `WHATSAPP_ACCESS_TOKEN` — direct Meta Cloud API send token (final client-owned account only at delivery).
- `WHATSAPP_PHONE_NUMBER_ID` — Cloud API phone-number id.
- `WHATSAPP_API_VERSION` — Cloud API version (v26.0 was the design-time reference; confirm the live version at deploy time).
- `FILE_LINK_SECRET` — short-lived signed file-link HMAC secret.
- `PORT`, `NODE_ENV`, `APP_BASE_URL`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT`, `REDIS_PORT`, `FRONTEND_PORT`.
- Full name list with empty values: `.env.example` (updated in Sprint 5 with `WHATSAPP_WEBHOOK_VERIFY_TOKEN` and `FILE_LINK_SECRET`).

## 3. Database setup (PostgreSQL 16)

1. Create the database and a NON-OWNER application role (not the database owner, not a superuser).
2. Apply the migration: `backend/prisma/migrations/20261102040000_init/migration.sql` (or `prisma migrate deploy` once the Prisma Store exists and `prisma validate`/`generate` pass on the deploy machine — they FAIL in the build environment; see §6).
3. Verify the migration: 16 tables, 10 enums, TransactionState = exactly 15 states, UNIQUE deposit reference, UNIQUE whatsapp_message_id, UNIQUE (transaction_id, role), immutability triggers on `contract_versions` and `audit_events`.
4. Revoke write access on append-only tables from the application role (database-level enforcement, not only application code):
   ```sql
   REVOKE UPDATE, DELETE ON audit_events FROM <app_role>;
   REVOKE UPDATE, DELETE ON contract_versions FROM <app_role>;
   ```
   Then verify a test UPDATE against each table fails. (In the Sprint 1 migration the triggers already block these writes; the REVOKE is the second, role-level layer — apply both and record the verification.)
5. Confirm the separation-of-duties rule is NOT expected from the database: it is a backend Guard (funding confirmer ≠ settlement approver), tested as critical test 5.

## 4. Application deployment (Docker Compose path — file-reviewed, NOT run here)

1. `docker compose config` — must render without errors (could NOT be run in the build environment: no Docker binary; run it on the deploy machine and record the output).
2. `docker compose up -d --build` — backend (Node 20, port 3000 in-container), frontend (Vite preview, 5173), postgres:16, redis:7, with healthchecks (postgres `pg_isready`, redis `redis-cli ping`).
3. Smoke checks: GET /health → 200 `{"ok":true}`; an unauthenticated API call → 401; webhook GET with a wrong verify token → 403; webhook GET with the correct token → 200 + challenge.
4. Run the full backend + frontend suites on the deploy machine (Node 20) and record both runs; a failing suite blocks the deploy.
5. Migrate Meta linking LAST, in the client's name: test account → final account/WABA/number, then return/handover administrative permissions and product access data to the client.

## 5. Backup schedule (daily, encrypted)

- Daily: `pg_dump` (custom format) + object-storage copy, encrypted, copied off-host, checksum-verified, logged (date, file name, checksum, object count, operator, verification result). Default retention proposed: 30 daily copies (client policy decides).
- Periodic restore test to a SEPARATE target with a written restore record (docs/backup-restore-runbook.md §4). Until a real restore record exists, restore capability is UNVERIFIED — say so.
- Never put secret values in a backup. A backup containing one is a security incident: delete it, rotate the secret, re-backup.

## 6. What blocks a real deploy TODAY (honest, from the build environment)

- B1 — No live Postgres could be started here: `psql`, `pg_dump`, `docker`, `podman`, `redis-server`, `redis-cli` are ALL absent; `apt-cache policy` returned nothing usable, and no install was attempted (no approval for machine changes). Migrations are therefore verified by file review + YAML/schema cross-check ONLY, never applied.
- B2 — `npx prisma@5 validate` and `npx prisma@5 generate` both exit 1 in this environment (only an npm "package was not found and will be installed" warning; no validation output). The Sprint 1 schema was NOT tool-validated, no Prisma client was generated, and NO Prisma Store implementation was added — adding an untested Prisma dependency would break `npm ci` reproducibility. Re-run both commands where registry access works, then implement the Prisma Store (Store interface checklist in docs/service-interface.md + inbox read model: MessageLog listing for the inbox endpoints), then apply the migration and re-run the full suite against Postgres.
- B3 — Live Redis, live Meta sends, live Postgres restore, Docker Compose up, GitHub Actions runs, and Node 20 behaviour are all UNVERIFIED (local Node is 24.22.1; Dockerfiles/CI pin Node 20).
- B4 — GitHub push and Render deploy require Ahmed's separate explicit written authorisation (and, for the repo, a separate confirmation before any branch replacement). Neither is given in this task.

## 7. Delivery package contents (CORE PROMPT §14.2 — where each item lives)

- Full source code: `backend/`, `frontend/` in this tree.
- Repository access: to be granted by Ahmed (repo owner) — NOT done here; no push was made.
- Database schema: `backend/prisma/schema.prisma` (582 lines).
- Migrations: `backend/prisma/migrations/20261102040000_init/migration.sql` (312 lines).
- Configuration WITHOUT secrets: `docker-compose.yml`, `.env.example`, `.env.development.example`, `.env.production.example`, Dockerfiles.
- Technical documentation: `docs/` (backlog, transition matrix, service interface, WhatsApp test path + real-transport swap, backup/restore runbook, sprint reports, checkpoint, UAT script, operator runbook, compliance report, OSS licences, this checklist).
- Runbooks: `docs/operator-runbook.md`, `docs/backup-restore-runbook.md`, this file.
- Access-data handover note: NAMES ONLY, in §2 above and `docs/operator-runbook.md` §10. No values anywhere.
- OSS licence list: `docs/oss-licences.md` (generated from the installed trees).
- Hosting/domain/external accounts in the client's name wherever the provider allows: a deploy-machine task, not done here.
