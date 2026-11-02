// Pilot System v3.1 — Sprint 2 (PB-09). Append-only audit writer.
// The ONLY way to add an audit row is createAuditEvent. Update and
// delete paths exist solely to refuse: they throw IMMUTABLE_ROW, which
// mirrors the migration triggers on audit_events. No service in this
// codebase may edit an audit row in place.
import { Injectable } from '@nestjs/common';
import { newCorrelationId } from '../common/ids';
import type { AuditEvent, Store } from '../store/repository';
import type { TransactionState } from '../common/transaction-state';

export interface AuditWriteInput {
  correlationId?: string;
  transactionId: string | null;
  actorId: string | null;
  actorRole: string;
  action: string;
  previousState: TransactionState | null;
  newState: TransactionState | null;
  details?: Record<string, unknown> | null;
}

@Injectable()
export class AuditService {
  constructor(private readonly store: Store) {}

  record(input: AuditWriteInput): AuditEvent {
    return this.store.createAuditEvent({
      correlation_id: input.correlationId ?? newCorrelationId(),
      transaction_id: input.transactionId,
      actor_id: input.actorId,
      actor_role: input.actorRole,
      action: input.action,
      previous_state: input.previousState,
      new_state: input.newState,
      details: input.details ?? null,
    });
  }

  /** Records a rejected attempt. Rejections are audit facts too. */
  recordRejection(input: AuditWriteInput): AuditEvent {
    return this.record({ ...input, action: 'TRANSITION_REJECTED' });
  }

  forTransaction(transactionId: string): AuditEvent[] {
    return this.store.auditForTransaction(transactionId);
  }

  /** Refusal path, tested: audit rows cannot be updated. */
  attemptUpdate(id: string, patch: Partial<AuditEvent>): never {
    return this.store.updateAuditEvent(id, patch);
  }

  /** Refusal path, tested: audit rows cannot be deleted. */
  attemptDelete(id: string): never {
    return this.store.deleteAuditEvent(id);
  }
}
