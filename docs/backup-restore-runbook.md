# Backup & Restore Runbook — Pilot System v3.1 (Sprint 3, PB-25)

Status: procedure + unit-tested snapshot round-trip. A LIVE restore
against PostgreSQL is UNVERIFIED in this environment and belongs to
Sprint 5 (see §4). Do not describe the snapshot test in §3 as a
production restore test.

## 1. What is backed up (and why)

- PostgreSQL database (all tables, including append-only
  `audit_events` and `contract_versions` — these are never edited,
  only copied).
- Object-storage files (contract files, receipt images, evidence
  documents) referenced by `storage_file_id` / `receipt_file_id`.
- Configuration WITHOUT secrets (`.env.example`-style variable names
  only; secret values live in the environment/secret store, never in
  the backup).

What is NEVER in a backup: secret values, tokens, passwords, or
Meta access data. If a backup file contains one, treat it as a
security incident: delete it, rotate the secret, re-backup.

## 2. Production backup (Sprint 5 deployment — commands for the operator)

Run daily (encrypted, off-host copy; retention per the client's
policy — the pilot default proposed here is 30 daily copies):

```bash
# Database dump (PostgreSQL 16; connection string from the
# environment variable name DATABASE_URL — never paste a value here)
pg_dump "$DATABASE_URL" --format=custom --file="pilot-backup-$(date +%F).dump"

# Object-storage copy (S3-compatible bucket; bucket name from config)
# Use the provider's sync/copy tool for the configured bucket.
# Verify: object count before == object count after.

# Encrypt + copy off-host, then verify the copy's checksum matches.
```

Record every backup in a backup log: date, dump file name,
checksum, object count, operator, verification result. A backup
without a log entry is treated as not taken.

## 3. Restore test — what Sprint 3 proves (test double)

Automated test: `backend/src/backup/backup.restore.spec.ts`.

1. Build a store with a transaction, a contract version, payment
   evidence (status `PAYMENT_EVIDENCE_SUBMITTED`), and audit rows.
2. Export a snapshot (`BackupService.exportSnapshot`).
3. Validate it (`validateSnapshot`: states within the 15, evidence
   statuses single-valued, audit rows carry action + correlation id).
4. Import into a FRESH store (`restoreSnapshot`).
5. Assert: transaction id + state preserved, evidence status
   preserved, audit row count preserved, and the restored store
   serves the transaction.
6. Negative cases (also tested): a snapshot with a tampered evidence
   status fails validation and is never imported; import into a
   NON-empty store is refused (fresh-store-only) rather than merged.

HTTP surface (staff-only, `admin.manage`): POST
`/api/admin/backup/export` returns the snapshot JSON; POST
`/api/admin/backup/import` validates + imports (fresh-store-only).
In the test-double deployment these endpoints operate on the
in-memory store; in production they are NOT the restore path — §4
is.

Known test-double limitation: snapshot dates revive as ISO strings
(JSON round-trip), not `Date` objects. The Prisma implementation
must revive them as dates; the round-trip test asserts states,
statuses, ids, and counts, not date object identity.

## 4. Production restore test (Sprint 5 — procedure, NOT yet executed)

1. Provision a SEPARATE restore target (never restore over the live
   database in place).
2. Restore the dump: `pg_restore` into the target database.
3. Restore the object-storage copy into a separate bucket/prefix.
4. Start the application against the target (read-only smoke mode
   first) and verify: transaction count, audit row count, evidence
   statuses, deposit-reference uniqueness (no duplicates), and one
   full transaction lifecycle read (detail endpoint) match the
   backup log.
5. Record a written restore record: date, backup file used, target,
   checks performed, result, operator, sign-off. Only after a
   passing restore record may the restored copy be promoted.
6. Until step 5 passes on a real target, the restore capability is
   UNVERIFIED — say so in every Sprint report.

## 5. Failure handling

- Backup job fails: alert operations staff the same day; retry once
  from a clean state; if the retry fails, escalate — never silently
  skip a day.
- Restore validation fails (tampered evidence status, unknown
  state, missing correlation id): STOP. Do not import. Escalate to
  staff for manual review — a failed validation is a data-integrity
  signal, not a retry prompt.
- Duplicate deposit reference after restore: surface to staff for
  manual review (same rule as the live funding gate). Never
  auto-resolve a duplicate.
