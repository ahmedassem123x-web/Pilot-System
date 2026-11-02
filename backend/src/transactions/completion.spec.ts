// COMPLETED is reachable ONLY from SETTLED (row 21) and REFUNDED
// (row 26). Every earlier-state shortcut is forbidden (matrix §5
// item 2). Uses the IN-MEMORY TEST DOUBLE only.
import { DomainError } from '../common/errors';
import {
  createTestEnv,
  draftTx,
  fullStaffActor,
  toAccepted,
  toAwaiting,
  toDelivered,
  toFunded,
  toInFulfilment,
  toPendingReview,
  toReceiptConfirmed,
  toRefundPending,
  toRefunded,
  toSettled,
  toSettlementPending,
  walkTo,
} from '../testing/builders';
import type { TransactionState } from '../common/transaction-state';

describe('COMPLETED only from SETTLED or REFUNDED', () => {
  const earlier: TransactionState[] = [
    'DRAFT',
    'PENDING_REVIEW',
    'ACCEPTED',
    'AWAITING_FUNDING_CONFIRMATION',
    'FUNDED_CONFIRMED',
    'IN_FULFILMENT',
    'DELIVERED',
    'RECEIPT_CONFIRMED',
    'SETTLEMENT_PENDING',
    'DISPUTED',
    'REFUND_PENDING',
  ];

  it.each(earlier)(
    'COMPLETED from %s is rejected',
    (state) => {
      const env = createTestEnv();
      const ctx = walkTo(env, draftTx(env), state);
      const actor = fullStaffActor(env);
      expect(() =>
        env.txs.transition(ctx.tx.id, actor, 'COMPLETED'),
      ).toThrow(DomainError);
      expect(env.txs.getTransaction(ctx.tx.id).state).toBe(state);
    },
  );

  it('COMPLETED from SETTLED works (row 21)', () => {
    const env = createTestEnv();
    const settled = toSettled(env, draftTx(env));
    const actor = fullStaffActor(env);
    env.txs.transition(settled.tx.id, actor, 'COMPLETED');
    expect(env.txs.getTransaction(settled.tx.id).state).toBe('COMPLETED');
  });

  it('COMPLETED from REFUNDED works (row 26)', () => {
    const env = createTestEnv();
    const refunded = toRefunded(env, draftTx(env));
    const actor = fullStaffActor(env);
    env.txs.transition(refunded.tx.id, actor, 'COMPLETED');
    expect(env.txs.getTransaction(refunded.tx.id).state).toBe('COMPLETED');
  });

  it('REFUND_PENDING -> COMPLETED is rejected (refund must be recorded first)', () => {
    const env = createTestEnv();
    const refundPending = toRefundPending(env, draftTx(env));
    const actor = fullStaffActor(env);
    expect(() =>
      env.txs.transition(refundPending.tx.id, actor, 'COMPLETED'),
    ).toThrow(DomainError);
  });

  it('every earlier state is reachable in the walk (sanity: the walk itself is not vacuous)', () => {
    const env = createTestEnv();
    const states: Array<[string, (e: ReturnType<typeof createTestEnv>, c: ReturnType<typeof draftTx>) => ReturnType<typeof draftTx>]> = [
      ['PENDING_REVIEW', (e, c) => toPendingReview(e, c)],
      ['ACCEPTED', (e, c) => toAccepted(e, c)],
      ['AWAITING_FUNDING_CONFIRMATION', (e, c) => toAwaiting(e, c)],
      ['FUNDED_CONFIRMED', (e, c) => toFunded(e, c)],
      ['IN_FULFILMENT', (e, c) => toInFulfilment(e, c)],
      ['DELIVERED', (e, c) => toDelivered(e, c)],
      ['RECEIPT_CONFIRMED', (e, c) => toReceiptConfirmed(e, c)],
      ['SETTLEMENT_PENDING', (e, c) => toSettlementPending(e, c)],
    ];
    for (const [state, walk] of states) {
      const ctx = walk(env, draftTx(env));
      expect(ctx.tx.state).toBe(state);
    }
  });
});
