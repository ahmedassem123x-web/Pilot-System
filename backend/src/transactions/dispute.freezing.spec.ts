// Dispute freezing (matrix §4): while DISPUTED, closure, settlement
// and financial steps are blocked; only rows 22/23/24 exit.
// Uses the IN-MEMORY TEST DOUBLE only.
import { DomainError } from '../common/errors';
import {
  createTestEnv,
  draftTx,
  fullStaffActor,
  toDisputed,
  toSettlementPending,
} from '../testing/builders';
import type { TransactionState } from '../common/transaction-state';

describe('dispute freezing', () => {
  it('while DISPUTED, closure/settlement/financial transitions are rejected + audited', () => {
    const env = createTestEnv();
    const disputed = toDisputed(env, draftTx(env), 'FUNDED_CONFIRMED');
    const actor = fullStaffActor(env);
    const blocked: TransactionState[] = [
      'COMPLETED',
      'SETTLED',
      'REFUNDED',
      'FUNDED_CONFIRMED',
      'IN_FULFILMENT',
      'RECEIPT_CONFIRMED',
      'SETTLEMENT_PENDING',
      'AWAITING_FUNDING_CONFIRMATION',
    ];
    for (const to of blocked) {
      expect(() =>
        env.txs.transition(disputed.tx.id, actor, to, {
          settlementSummary: undefined,
          refundConfirmation: {
            settlementReference: 'REF-FROZEN',
            executedAmount: 1200,
            currency: 'USD',
            beneficiary: 'Buyer',
            executionDate: '2026-11-02',
            confirmationDocument: 'doc',
          },
        }),
      ).toThrow(DomainError);
    }
    expect(env.txs.getTransaction(disputed.tx.id).state).toBe('DISPUTED');
    const rejections = env.store
      .auditForTransaction(disputed.tx.id)
      .filter((a) => a.action === 'TRANSITION_REJECTED');
    expect(rejections.length).toBeGreaterThanOrEqual(blocked.length);
  });

  it('no settlement summary may be treated as executed while DISPUTED', () => {
    const env = createTestEnv();
    const disputed = toDisputed(env, draftTx(env), 'SETTLEMENT_PENDING');
    // Settlement preparation happened before the dispute, but the
    // SETTLED step itself is blocked while the dispute is open.
    const actor = fullStaffActor(env);
    expect(() =>
      env.txs.transition(disputed.tx.id, actor, 'SETTLED'),
    ).toThrow(DomainError);
    expect(env.txs.getTransaction(disputed.tx.id).state).toBe('DISPUTED');
  });

  it('only rows 22/23/24 exit DISPUTED, and only after human resolution', () => {
    const env = createTestEnv();
    const disputed = toDisputed(env, draftTx(env), 'FUNDED_CONFIRMED');
    const actor = fullStaffActor(env);
    // Without any resolution, even the legal exits are rejected.
    expect(() =>
      env.txs.transition(disputed.tx.id, actor, 'REFUND_PENDING'),
    ).toThrow(DomainError);
    expect(() =>
      env.txs.transition(disputed.tx.id, actor, 'CANCELLED', {
        cancellationReason: 'no resolution',
      }),
    ).toThrow(DomainError);
    // After human resolution, the matching exit works.
    const resolver = fullStaffActor(env);
    env.txs.resolveDispute(disputed.tx.id, {
      outcome: 'REFUND',
      resolution: 'Human decided refund',
      resolvedBy: resolver.id,
    });
    env.txs.transition(disputed.tx.id, resolver, 'REFUND_PENDING');
    expect(env.txs.getTransaction(disputed.tx.id).state).toBe('REFUND_PENDING');
  });

  it('a post-acceptance dispute freezes settlement but does not undo the recorded acceptance', () => {
    const env = createTestEnv();
    const receipt = toSettlementPending(env, draftTx(env));
    const actor = fullStaffActor(env);
    env.txs.transition(receipt.tx.id, actor, 'DISPUTED', {
      disputeReason: 'Dispute after settlement prepared',
      disputeEvidenceFileIds: ['f1'],
    });
    expect(env.txs.getTransaction(receipt.tx.id).state).toBe('DISPUTED');
    const acceptance = env.store
      .auditForTransaction(receipt.tx.id)
      .filter((a) => a.action === 'RECEIPT_CONFIRMED_BY_BUYER');
    expect(acceptance).toHaveLength(1);
    // Settlement is frozen until human resolution returns the tx.
    expect(() =>
      env.txs.transition(receipt.tx.id, actor, 'SETTLED'),
    ).toThrow(DomainError);
    const resolver = fullStaffActor(env);
    env.txs.resolveDispute(receipt.tx.id, {
      outcome: 'PROCEED',
      resolution: 'Proceed to settlement',
      resolvedBy: resolver.id,
    });
    env.txs.transition(receipt.tx.id, resolver, 'SETTLEMENT_PENDING');
    expect(env.txs.getTransaction(receipt.tx.id).state).toBe('SETTLEMENT_PENDING');
  });
});
