// Pilot System v3.1 — Sprint 3 (PB-25). Backup export + restore
// validation, over the Store snapshot shape.
//
// WHAT THIS IS: a unit-tested export/restore round-trip for the
// in-memory test store: export a snapshot, validate it, import it
// into a FRESH store, and prove the restored data matches (transaction
// states, audit rows, evidence statuses, references). The procedure,
// schedule, and production commands live in
// docs/backup-restore-runbook.md.
//
// WHAT THIS IS NOT: a live PostgreSQL backup. Production backup uses
// database dumps and object-storage copies (runbook §2); a live
// restore against PostgreSQL is UNVERIFIED in this environment and
// belongs to Sprint 5. Do NOT describe a snapshot round-trip here as
// a production restore test.
//
// SAFETY: import is fresh-store-only (enforced by the store): a
// snapshot can never silently merge into a store that already holds
// transactions or audit events.
import { Injectable } from '@nestjs/common';
import { DomainError } from '../common/errors';
import { TRANSACTION_STATES } from '../common/transaction-state';
import type { Store, StoreSnapshot } from '../store/repository';

@Injectable()
export class BackupService {
  constructor(private readonly store: Store) {}

  exportSnapshot(): StoreSnapshot {
    return this.store.exportSnapshot();
  }

  validateSnapshot(snapshot: StoreSnapshot): {
    valid: boolean;
    problems: string[];
  } {
    const problems: string[] = [];
    if (!snapshot || typeof snapshot !== 'object') {
      return { valid: false, problems: ['snapshot is not an object'] };
    }
    const states = new Set<string>(TRANSACTION_STATES as readonly string[]);
    for (const tx of snapshot.transactions ?? []) {
      if (!states.has(tx.state)) {
        problems.push(`transaction ${tx.id} has unknown state ${tx.state}`);
      }
    }
    for (const evidence of snapshot.evidences ?? []) {
      if (evidence.status !== 'PAYMENT_EVIDENCE_SUBMITTED') {
        problems.push(
          `evidence ${evidence.id} has status ${evidence.status} — evidence must always read Payment Evidence Submitted`,
        );
      }
    }
    for (const audit of snapshot.auditEvents ?? []) {
      if (!audit.action || !audit.correlation_id) {
        problems.push(`audit event ${audit.id} is missing action or correlation_id`);
      }
    }
    return { valid: problems.length === 0, problems };
  }

  restoreSnapshot(snapshot: StoreSnapshot): StoreSnapshot {
    const validation = this.validateSnapshot(snapshot);
    if (!validation.valid) {
      throw new DomainError(
        'INVALID_INPUT',
        422,
        `Snapshot failed validation: ${validation.problems.join('; ')}`,
      );
    }
    this.store.importSnapshot(snapshot);
    return this.store.exportSnapshot();
  }
}
