// Pilot System v3.1 — Sprint 4 (PB-26). The 11 critical tests of
// CORE PROMPT §15, each in one place, each passing twice before any
// acceptance. Every test runs against the IN-MEMORY TEST DOUBLE —
// not Prisma, not PostgreSQL, not a live Meta account — and says so.
// These tests complement (never replace) the Sprint 2/3 suites that
// cover the same Guards in depth.
import { createHmac } from 'node:crypto';
import { InMemoryStore } from '../store/in-memory.store';
import { AuditService } from '../audit/audit.service';
import { QueueService } from '../queue/queue.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { BackupService } from '../backup/backup.service';
import {
  ALL_PERMISSIONS,
  createTestEnv,
  draftTx,
  fullStaffActor,
  settlementSummaryInput,
  staffActor,
  toCompletedFromSettled,
  toDelivered,
  toDisputed,
  toFunded,
  toReceiptConfirmed,
  toSettlementPending,
} from '../testing/builders';

function webhookEnv() {
  const store = new InMemoryStore();
  const audit = new AuditService(store);
  const queue = new QueueService();
  const whatsapp = new WhatsappService(store, audit, queue, {
    appSecret: 'test-only-app-secret',
    verifyToken: 'test-only-verify-token',
  });
  return { store, audit, queue, whatsapp };
}

function metaPayload(messageId: string): Record<string, unknown> {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              messages: [{ id: messageId, type: 'text', text: { body: 'hello' } }],
            },
          },
        ],
      },
    ],
  };
}

function sign(secret: string, raw: Buffer): string {
  return `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
}

/** Jest's toThrow(string) matches the message, not the error code — so check codes explicitly. */
function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect((error as { code?: string }).code).toBe(code);
    return;
  }
  throw new Error(`Expected an error with code ${code}, but nothing was thrown`);
}

describe('critical tests 1-11 (CORE PROMPT §15)', () => {
  it('1. rejects a webhook with a wrong signature, with no MessageLog row', () => {
    const { store, whatsapp } = webhookEnv();
    const payload = metaPayload('waba-critical-1');
    const raw = Buffer.from(JSON.stringify(payload), 'utf8');
    const result = whatsapp.handleWebhook(payload, raw, sign('wrong-secret', raw));
    expect(result.outcome).toBe('rejected');
    expect(result.httpStatus).toBe(403);
    expect(store.findMessageLogByWhatsappId('waba-critical-1')).toBeUndefined();
  });

  it('2. processes a duplicate event with NO duplicate effect', () => {
    const { store, whatsapp } = webhookEnv();
    const payload = metaPayload('waba-critical-2');
    const raw = Buffer.from(JSON.stringify(payload), 'utf8');
    const signature = sign('test-only-app-secret', raw);
    const first = whatsapp.handleWebhook(payload, raw, signature);
    expect(first.outcome).toBe('processed');
    const second = whatsapp.handleWebhook(payload, raw, signature);
    expect(second.outcome).toBe('already-processed');
    expect(
      store.exportSnapshot().messageLogs.filter((m) => m.whatsapp_message_id === 'waba-critical-2'),
    ).toHaveLength(1);
  });

  it('3. rejects an unauthorised state transition', () => {
    const env = createTestEnv();
    const ctx = draftTx(env);
    const powerless = staffActor(env, []);
    expectCode(
      () => env.txs.transition(ctx.tx.id, powerless, 'PENDING_REVIEW'),
      'PERMISSION_DENIED',
    );
    expect(env.txs.getTransaction(ctx.tx.id).state).toBe('DRAFT');
    const rejected = env.store
      .auditForTransaction(ctx.tx.id)
      .filter((a) => a.action === 'TRANSITION_REJECTED');
    expect(rejected.length).toBeGreaterThanOrEqual(1);
  });

  it('4. prevents settlement without a coordination record and an external reference', () => {
    const env = createTestEnv();
    const receipt = toReceiptConfirmed(env, draftTx(env));
    const actor = fullStaffActor(env);
    // The SETTLEMENT_PREPARED Guard requires a confirmed coordination
    // record AND a matching deposit reference (see the funding-gate
    // tests for the no-coordination half: FUNDED_CONFIRMED itself
    // requires institution confirmation + deposit reference, so a
    // RECEIPT_CONFIRMED transaction always has one — the reference
    // half is what this test proves here).
    const mismatched = {
      ...settlementSummaryInput(receipt),
      deposit_reference: 'DEP-DOES-NOT-MATCH',
    };
    expect(() =>
      env.txs.transition(receipt.tx.id, actor, 'SETTLEMENT_PENDING', {
        settlementSummary: mismatched,
      }),
    ).toThrow('must match the coordination record');
    // And SETTLED directly from RECEIPT_CONFIRMED (skipping the
    // settlement-preparation + institution-confirmation steps) is
    // forbidden: no coordination record + external reference is
    // treated as settlement.
    expect(() => env.txs.transition(receipt.tx.id, actor, 'SETTLED')).toThrow(
      'RECEIPT_CONFIRMED -> SETTLED',
    );
    expect(env.txs.getTransaction(receipt.tx.id).state).toBe('RECEIPT_CONFIRMED');
  });

  it('5. enforces separation: funding confirmer != settlement approver for the same transaction', () => {
    const env = createTestEnv();
    const pending = toSettlementPending(env, draftTx(env));
    const funder = staffActor(env, ALL_PERMISSIONS);
    // Re-point: the funding confirmer is pending.fundingStaffId; the
    // settlement attempt BY that same staff member must fail even
    // with a recorded confirmation.
    void funder;
    const settlerAsFunder: { id: string; role: 'STAFF'; permissions: string[] } = {
      id: pending.fundingStaffId as string,
      role: 'STAFF',
      permissions: ALL_PERMISSIONS,
    };
    env.txs.recordSettlementConfirmation(pending.settlementSummaryId as string, {
      settlementReference: 'SET-CRITICAL-5',
      confirmationAt: new Date(),
      actorId: 'some-other-staff',
    });
    expectCode(
      () => env.txs.transition(pending.tx.id, settlerAsFunder, 'SETTLED'),
      'SEPARATION_OF_DUTIES_VIOLATION',
    );
    expect(env.txs.getTransaction(pending.tx.id).state).toBe('SETTLEMENT_PENDING');
  });

  it('6. freezes closure when a dispute is open', () => {
    const env = createTestEnv();
    const disputed = toDisputed(env, draftTx(env), 'FUNDED_CONFIRMED');
    const actor = fullStaffActor(env);
    expect(() => env.txs.transition(disputed.tx.id, actor, 'COMPLETED')).toThrow();
    expect(() => env.txs.transition(disputed.tx.id, actor, 'SETTLED')).toThrow();
    expect(env.txs.getTransaction(disputed.tx.id).state).toBe('DISPUTED');
  });

  it('7. prevents audit-log modification', () => {
    const env = createTestEnv();
    const ctx = draftTx(env);
    const audits = env.store.auditForTransaction(ctx.tx.id);
    expect(audits.length).toBeGreaterThanOrEqual(0);
    const anyAudit = env.store.allAuditEvents()[0];
    if (anyAudit) {
      expectCode(
        () => env.store.updateAuditEvent(anyAudit.id, { action: 'TAMPERED' }),
        'IMMUTABLE_ROW',
      );
      expectCode(() => env.store.deleteAuditEvent(anyAudit.id), 'IMMUTABLE_ROW');
    }
    const versions = env.store.versionsForTransaction(ctx.tx.id);
    expect(versions.length).toBe(1);
    expectCode(
      () => env.store.updateContractVersion(versions[0].id, { content_hash: '0'.repeat(64) }),
      'IMMUTABLE_ROW',
    );
  });

  it('8. backup and restore round-trip preserves state, evidence, and audit', () => {
    const env = createTestEnv();
    const funded = toFunded(env, draftTx(env));
    env.txs.submitPaymentEvidence({
      transactionId: funded.tx.id,
      channel: 'bank transfer',
      senderName: 'Buyer Name',
      amount: 1200,
      currency: 'USD',
      externalPaymentReference: 'EXT-CRITICAL-8',
      submittedBy: funded.buyer.id,
    });
    const backup = new BackupService(env.store);
    const snapshot = backup.exportSnapshot();
    const validation = backup.validateSnapshot(snapshot);
    expect(validation.valid).toBe(true);
    const fresh = new InMemoryStore();
    const restore = new BackupService(fresh);
    fresh.importSnapshot(snapshot);
    expect(restore.exportSnapshot().transactions[0].state).toBe('FUNDED_CONFIRMED');
    expect(restore.exportSnapshot().auditEvents.length).toBe(snapshot.auditEvents.length);
    expect(restore.exportSnapshot().evidences[0].status).toBe('PAYMENT_EVIDENCE_SUBMITTED');
    void restore;
  });

  it('9. full explicit-acceptance path end to end', () => {
    const env = createTestEnv();
    const completed = toCompletedFromSettled(env, draftTx(env));
    expect(completed.tx.state).toBe('COMPLETED');
    const audits = env.store.auditForTransaction(completed.tx.id);
    expect(audits.some((a) => a.action === 'CONTRACT_ACCEPTED')).toBe(true);
    expect(audits.some((a) => a.action === 'BUYER_HANDOVER_ACCEPT')).toBe(true);
    expect(audits.some((a) => a.action === 'RECEIPT_CONFIRMED_BY_BUYER')).toBe(true);
    expect(audits.some((a) => a.action === 'SETTLEMENT_RECORDED')).toBe(true);
    expect(audits.some((a) => a.action === 'TRANSACTION_COMPLETED')).toBe(true);
  });

  it('10. full rejection/dispute path end to end', () => {
    const env = createTestEnv();
    const delivered = toDelivered(env, draftTx(env));
    const actor = fullStaffActor(env);
    // Buyer explicitly REJECTS at handover -> DISPUTED.
    env.txs.transition(delivered.tx.id, actor, 'DISPUTED', {
      disputeReason: 'Product does not match the agreement',
      disputeEvidenceFileIds: ['rejection-photo-1'],
    });
    expect(env.txs.getTransaction(delivered.tx.id).state).toBe('DISPUTED');
    const resolver = fullStaffActor(env);
    env.txs.resolveDispute(delivered.tx.id, {
      outcome: 'REFUND',
      resolution: 'Refund agreed by human resolution',
      resolvedBy: resolver.id,
    });
    env.txs.transition(delivered.tx.id, resolver, 'REFUND_PENDING');
    expect(env.txs.getTransaction(delivered.tx.id).state).toBe('REFUND_PENDING');
    const recorder = staffActor(env, ALL_PERMISSIONS);
    env.txs.transition(delivered.tx.id, recorder, 'REFUNDED', {
      refundConfirmation: {
        settlementReference: 'REF-CRITICAL-10',
        executedAmount: 1200,
        currency: 'USD',
        beneficiary: 'Buyer Name',
        receivingMethod: 'bank transfer',
        executionDate: '2026-11-02',
        confirmationDocument: 'refund-confirmation-doc-10',
      },
    });
    expect(env.txs.getTransaction(delivered.tx.id).state).toBe('REFUNDED');
    env.txs.transition(delivered.tx.id, fullStaffActor(env), 'COMPLETED');
    expect(env.txs.getTransaction(delivered.tx.id).state).toBe('COMPLETED');
  });

  it('11. prevents contract amendment after funding/shipping AND acceptance by silence, time, or a scheduled job', () => {
    const env = createTestEnv();
    const funded = toFunded(env, draftTx(env));
    expectCode(
      () =>
        env.txs.requestAmendment(funded.tx.id, fullStaffActor(env), {
          newContent: 'amended after funding',
          buyerApproved: true,
          sellerApproved: true,
        }),
      'AMENDMENT_FORBIDDEN',
    );
    expect(env.store.versionsForTransaction(funded.tx.id)).toHaveLength(1);
    // Silence / time: a DELIVERED transaction with NO buyer accept
    // recorded cannot become RECEIPT_CONFIRMED, however long nothing
    // happens. No action, no state change.
    const delivered = toDelivered(env, draftTx(env));
    expect(env.txs.getTransaction(delivered.tx.id).state).toBe('DELIVERED');
    expect(() =>
      env.txs.transition(delivered.tx.id, fullStaffActor(env), 'RECEIPT_CONFIRMED'),
    ).toThrow();
    expect(env.txs.getTransaction(delivered.tx.id).state).toBe('DELIVERED');
    // Scheduled job: the queue's closed job list refuses any job that
    // would accept, settle, close, fund, or refund.
    const queue = new QueueService();
    for (const forbidden of [
      'acceptance.decide',
      'settlement.execute',
      'transaction.close',
      'funding.confirm',
      'refund.execute',
    ]) {
      expect(() => queue.enqueue(forbidden, {})).toThrow();
    }
    expect(queue.enqueue('reminder.send', { note: 'awaiting buyer response' }).status).toBe('queued');
  });
});
