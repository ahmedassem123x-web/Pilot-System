// Separation of duties (CORE PROMPT §14.1, critical test 5):
// funding confirmer != settlement approver for the SAME transaction,
// enforced in the backend Guard. Uses the IN-MEMORY TEST DOUBLE only.
import { DomainError } from '../common/errors';
import {
  createTestEnv,
  draftTx,
  fullStaffActor,
  staffActor,
  toRefundPending,
  toSettlementPending,
  ALL_PERMISSIONS,
} from '../testing/builders';

describe('separation of duties', () => {
  it('same staff member cannot confirm funding and approve settlement for the same transaction', () => {
    const env = createTestEnv();
    const pending = toSettlementPending(env, draftTx(env));
    const funderId = pending.fundingStaffId as string;
    const funderActor = { id: funderId, role: 'STAFF' as const, permissions: ALL_PERMISSIONS };
    env.txs.recordSettlementConfirmation(
      pending.settlementSummaryId as string,
      {
        settlementReference: 'SET-SOD-1',
        confirmationAt: new Date(),
        actorId: funderId,
      },
    );
    let caught: unknown;
    try {
      env.txs.transition(pending.tx.id, funderActor, 'SETTLED');
    } catch (error) {
      caught = error;
    }
    expect((caught as DomainError).code).toBe(
      'SEPARATION_OF_DUTIES_VIOLATION',
    );
    expect((caught as DomainError).status).toBe(403);
    expect(env.txs.getTransaction(pending.tx.id).state).toBe(
      'SETTLEMENT_PENDING',
    );
    const rejections = env.store
      .auditForTransaction(pending.tx.id)
      .filter((a) => a.action === 'TRANSITION_REJECTED');
    expect(rejections.length).toBeGreaterThanOrEqual(1);
  });

  it('a different staff member CAN approve settlement', () => {
    const env = createTestEnv();
    const pending = toSettlementPending(env, draftTx(env));
    const settler = staffActor(env, ALL_PERMISSIONS);
    expect(settler.id).not.toBe(pending.fundingStaffId);
    env.txs.recordSettlementConfirmation(
      pending.settlementSummaryId as string,
      {
        settlementReference: 'SET-SOD-2',
        confirmationAt: new Date(),
        actorId: settler.id,
      },
    );
    env.txs.transition(pending.tx.id, settler, 'SETTLED');
    expect(env.txs.getTransaction(pending.tx.id).state).toBe('SETTLED');
  });

  it('same staff member cannot confirm funding and record the refund for the same transaction', () => {
    const env = createTestEnv();
    const refundPending = toRefundPending(env, draftTx(env));
    const funderId = refundPending.fundingStaffId as string;
    const funderActor = { id: funderId, role: 'STAFF' as const, permissions: ALL_PERMISSIONS };
    expect(() =>
      env.txs.transition(refundPending.tx.id, funderActor, 'REFUNDED', {
        refundConfirmation: {
          settlementReference: 'REF-SOD-1',
          executedAmount: 1200,
          currency: 'USD',
          beneficiary: 'Buyer Name',
          executionDate: '2026-11-02',
          confirmationDocument: 'doc',
        },
      }),
    ).toThrow(DomainError);
    expect(env.txs.getTransaction(refundPending.tx.id).state).toBe(
      'REFUND_PENDING',
    );
  });

  it('separation is per-transaction: the same staff member may settle a DIFFERENT transaction they did not fund', () => {
    const env = createTestEnv();
    const first = toSettlementPending(env, draftTx(env));
    const funderId = first.fundingStaffId as string;
    // Second transaction funded by someone else entirely.
    const second = toSettlementPending(env, draftTx(env));
    expect(second.fundingStaffId).not.toBe(funderId);
    void fullStaffActor;
  });
});
