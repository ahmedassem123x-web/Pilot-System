// PB-08 positive tests: every allowed transition in
// docs/transition-matrix.md §3 (26 rows; row 22 exercised once per
// eligible return target). Uses the IN-MEMORY TEST DOUBLE only
// (see in-memory.store.ts header) — not a live database result.
import type { TransactionState } from '../common/transaction-state';
import type { TransitionInput } from './transactions.service';
import {
  createTestEnv,
  draftTx,
  fullStaffActor,
  settlementSummaryInput,
  staffActor,
  toAccepted,
  toAwaiting,
  toDelivered,
  toDisputed,
  toFunded,
  toInFulfilment,
  toPendingReview,
  toReceiptConfirmed,
  toRefundPending,
  toRefunded,
  toSettled,
  toSettlementPending,
  voucherInput,
  ALL_PERMISSIONS,
  TxContext,
  TestEnv,
} from '../testing/builders';

function expectTransitionAudit(
  env: TestEnv,
  txId: string,
  from: TransactionState,
  to: TransactionState,
  action: string,
): void {
  const audits = env.store.auditForTransaction(txId);
  const found = audits.filter(
    (a) =>
      a.action === action &&
      a.previous_state === from &&
      a.new_state === to,
  );
  expect(found).toHaveLength(1);
  expect(found[0].correlation_id).toBeTruthy();
  expect(found[0].timestamp).toBeTruthy();
}

function runCase(
  name: string,
  setup: (env: TestEnv) => TxContext,
  to: TransactionState,
  input: TransitionInput,
  action: string,
): void {
  it(name, () => {
    const env = createTestEnv();
    const ctx = setup(env);
    const from = ctx.tx.state;
    const actor = fullStaffActor(env);
    const updated = env.txs.transition(ctx.tx.id, actor, to, input);
    expect(updated.state).toBe(to);
    expectTransitionAudit(env, ctx.tx.id, from, to, action);
  });
}

describe('PB-08 state machine: all 26 allowed transitions', () => {
  runCase(
    'row 1: DRAFT -> PENDING_REVIEW',
    (env) => draftTx(env),
    'PENDING_REVIEW',
    {},
    'TRANSACTION_SUBMITTED_FOR_REVIEW',
  );

  runCase(
    'row 2: DRAFT -> CANCELLED',
    (env) => draftTx(env),
    'CANCELLED',
    { cancellationReason: 'Draft withdrawn' },
    'TRANSACTION_CANCELLED',
  );

  it('row 3: PENDING_REVIEW -> ACCEPTED', () => {
    const env = createTestEnv();
    const pending = toPendingReview(env, draftTx(env));
    const recorder = fullStaffActor(env);
    env.txs.recordPartyAcceptance(
      pending.tx.id,
      'BUYER',
      'waba-pos-buyer',
      recorder.id,
    );
    env.txs.recordPartyAcceptance(
      pending.tx.id,
      'SELLER',
      'waba-pos-seller',
      recorder.id,
    );
    env.txs.transition(pending.tx.id, recorder, 'ACCEPTED');
    expect(env.txs.getTransaction(pending.tx.id).state).toBe('ACCEPTED');
    expectTransitionAudit(
      env,
      pending.tx.id,
      'PENDING_REVIEW',
      'ACCEPTED',
      'CONTRACT_ACCEPTED',
    );
  });

  runCase(
    'row 4: PENDING_REVIEW -> CANCELLED',
    (env) => toPendingReview(env, draftTx(env)),
    'CANCELLED',
    { cancellationReason: 'Review withdrawn' },
    'TRANSACTION_CANCELLED',
  );

  it('row 5: ACCEPTED -> PENDING_REVIEW (amendment, both approvals, new version)', () => {
    const env = createTestEnv();
    const accepted = toAccepted(env, draftTx(env));
    const before = env.store.versionsForTransaction(accepted.tx.id).length;
    const actor = fullStaffActor(env);
    env.txs.transition(accepted.tx.id, actor, 'PENDING_REVIEW', {
      buyerApprovedAmendment: true,
      sellerApprovedAmendment: true,
      newContractContent: 'contract content version 2 amended',
    });
    expect(env.txs.getTransaction(accepted.tx.id).state).toBe('PENDING_REVIEW');
    const versions = env.store.versionsForTransaction(accepted.tx.id);
    expect(versions).toHaveLength(before + 1);
    expect(versions[0].content_hash).not.toBe(
      versions[versions.length - 1].content_hash,
    );
    expectTransitionAudit(
      env,
      accepted.tx.id,
      'ACCEPTED',
      'PENDING_REVIEW',
      'CONTRACT_AMENDMENT_REQUESTED',
    );
  });

  runCase(
    'row 6: ACCEPTED -> AWAITING_FUNDING_CONFIRMATION',
    (env) => toAccepted(env, draftTx(env)),
    'AWAITING_FUNDING_CONFIRMATION',
    { voucher: voucherInput() },
    'FUNDING_AWAITING_STARTED',
  );

  runCase(
    'row 7: ACCEPTED -> CANCELLED (both parties agreement)',
    (env) => toAccepted(env, draftTx(env)),
    'CANCELLED',
    {
      cancellationReason: 'Mutual cancellation',
      bothPartiesAgreement: true,
    },
    'TRANSACTION_CANCELLED',
  );

  it('row 8: AWAITING_FUNDING_CONFIRMATION -> FUNDED_CONFIRMED', () => {
    const env = createTestEnv();
    const awaiting = toAwaiting(env, draftTx(env));
    const funder = fullStaffActor(env);
    env.txs.recordCoordination({
      transactionId: awaiting.tx.id,
      staffId: funder.id,
      contactMethod: 'manual phone call',
      institutionResponse: 'Deposit booked',
      depositReference: 'DEP-POS-8',
      institutionConfirmed: true,
    });
    env.txs.transition(awaiting.tx.id, funder, 'FUNDED_CONFIRMED');
    expect(env.txs.getTransaction(awaiting.tx.id).state).toBe('FUNDED_CONFIRMED');
    expectTransitionAudit(
      env,
      awaiting.tx.id,
      'AWAITING_FUNDING_CONFIRMATION',
      'FUNDED_CONFIRMED',
      'FUNDING_CONFIRMED',
    );
  });

  runCase(
    'row 9: AWAITING_FUNDING_CONFIRMATION -> DISPUTED',
    (env) => toAwaiting(env, draftTx(env)),
    'DISPUTED',
    { disputeReason: 'Buyer dispute', disputeEvidenceFileIds: ['f1'] },
    'DISPUTE_OPENED',
  );

  runCase(
    'row 10: AWAITING_FUNDING_CONFIRMATION -> CANCELLED (both parties agreement)',
    (env) => toAwaiting(env, draftTx(env)),
    'CANCELLED',
    {
      cancellationReason: 'Mutual cancellation before funding',
      bothPartiesAgreement: true,
    },
    'TRANSACTION_CANCELLED',
  );

  runCase(
    'row 11: FUNDED_CONFIRMED -> IN_FULFILMENT',
    (env) => toFunded(env, draftTx(env)),
    'IN_FULFILMENT',
    { shippingConfirmed: true },
    'FULFILMENT_STARTED',
  );

  runCase(
    'row 12: FUNDED_CONFIRMED -> DISPUTED',
    (env) => toFunded(env, draftTx(env)),
    'DISPUTED',
    { disputeReason: 'Funding dispute', disputeEvidenceFileIds: ['f1'] },
    'DISPUTE_OPENED',
  );

  it('row 13: IN_FULFILMENT -> DELIVERED (+ readiness event and message)', () => {
    const env = createTestEnv();
    const fulfil = toInFulfilment(env, draftTx(env));
    const actor = fullStaffActor(env);
    env.txs.recordDeliveryEvent(
      fulfil.tx.id,
      'SELLER_ARRIVED_AT_DELIVERY_POINT',
      actor.id,
    );
    env.txs.transition(fulfil.tx.id, actor, 'DELIVERED');
    expect(env.txs.getTransaction(fulfil.tx.id).state).toBe('DELIVERED');
    const events = env.store.deliveryEventsForTransaction(fulfil.tx.id);
    expect(
      events.some((e) => e.event_type === 'HANDOVER_READINESS_NOTIFIED'),
    ).toBe(true);
    const readiness = env.store
      .messageLogsForTransaction(fulfil.tx.id)
      .filter((m) => m.template_name === 'handover_readiness');
    expect(readiness).toHaveLength(1);
    expect(readiness[0].is_dry_run).toBe(false);
    expectTransitionAudit(
      env,
      fulfil.tx.id,
      'IN_FULFILMENT',
      'DELIVERED',
      'PRODUCT_ARRIVED_AT_DELIVERY_POINT',
    );
  });

  runCase(
    'row 14: IN_FULFILMENT -> DISPUTED',
    (env) => toInFulfilment(env, draftTx(env)),
    'DISPUTED',
    { disputeReason: 'Fulfilment dispute', disputeEvidenceFileIds: ['f1'] },
    'DISPUTE_OPENED',
  );

  it('row 15: DELIVERED -> RECEIPT_CONFIRMED (explicit buyer accept at handover)', () => {
    const env = createTestEnv();
    const delivered = toDelivered(env, draftTx(env));
    const actor = fullStaffActor(env);
    env.txs.recordDeliveryEvent(
      delivered.tx.id,
      'BUYER_ARRIVED_AT_HANDOVER',
      actor.id,
    );
    env.txs.recordDeliveryEvent(
      delivered.tx.id,
      'HANDOVER_INSPECTION_COMPLETED',
      actor.id,
    );
    env.txs.recordHandoverAcceptance(
      delivered.tx.id,
      'waba-pos-handover',
      delivered.buyer.id,
    );
    env.txs.transition(delivered.tx.id, actor, 'RECEIPT_CONFIRMED');
    expect(env.txs.getTransaction(delivered.tx.id).state).toBe('RECEIPT_CONFIRMED');
    expectTransitionAudit(
      env,
      delivered.tx.id,
      'DELIVERED',
      'RECEIPT_CONFIRMED',
      'RECEIPT_CONFIRMED_BY_BUYER',
    );
  });

  runCase(
    'row 16: DELIVERED -> DISPUTED (explicit buyer REJECT)',
    (env) => toDelivered(env, draftTx(env)),
    'DISPUTED',
    { disputeReason: 'Buyer rejects product at handover', disputeEvidenceFileIds: ['f1'] },
    'DISPUTE_OPENED',
  );

  it('row 17: RECEIPT_CONFIRMED -> SETTLEMENT_PENDING', () => {
    const env = createTestEnv();
    const receipt = toReceiptConfirmed(env, draftTx(env));
    const actor = fullStaffActor(env);
    env.txs.transition(receipt.tx.id, actor, 'SETTLEMENT_PENDING', {
      settlementSummary: settlementSummaryInput(receipt),
    });
    expect(env.txs.getTransaction(receipt.tx.id).state).toBe('SETTLEMENT_PENDING');
    expect(
      env.store.settlementSummariesForTransaction(receipt.tx.id),
    ).toHaveLength(1);
    expectTransitionAudit(
      env,
      receipt.tx.id,
      'RECEIPT_CONFIRMED',
      'SETTLEMENT_PENDING',
      'SETTLEMENT_PREPARED',
    );
  });

  runCase(
    'row 18: RECEIPT_CONFIRMED -> DISPUTED',
    (env) => toReceiptConfirmed(env, draftTx(env)),
    'DISPUTED',
    { disputeReason: 'Post-acceptance dispute', disputeEvidenceFileIds: ['f1'] },
    'DISPUTE_OPENED',
  );

  it('row 19: SETTLEMENT_PENDING -> SETTLED (settler differs from funder)', () => {
    const env = createTestEnv();
    const pending = toSettlementPending(env, draftTx(env));
    const settler = staffActor(env, ALL_PERMISSIONS);
    expect(settler.id).not.toBe(pending.fundingStaffId);
    env.txs.recordSettlementConfirmation(
      pending.settlementSummaryId as string,
      {
        settlementReference: 'SET-POS-19',
        confirmationAt: new Date(),
        actorId: settler.id,
      },
    );
    env.txs.transition(pending.tx.id, settler, 'SETTLED');
    expect(env.txs.getTransaction(pending.tx.id).state).toBe('SETTLED');
    expectTransitionAudit(
      env,
      pending.tx.id,
      'SETTLEMENT_PENDING',
      'SETTLED',
      'SETTLEMENT_RECORDED',
    );
  });

  runCase(
    'row 20: SETTLEMENT_PENDING -> DISPUTED',
    (env) => toSettlementPending(env, draftTx(env)),
    'DISPUTED',
    { disputeReason: 'Settlement dispute', disputeEvidenceFileIds: ['f1'] },
    'DISPUTE_OPENED',
  );

  it('row 21: SETTLED -> COMPLETED', () => {
    const env = createTestEnv();
    const settled = toSettled(env, draftTx(env));
    const actor = fullStaffActor(env);
    env.txs.transition(settled.tx.id, actor, 'COMPLETED');
    expect(env.txs.getTransaction(settled.tx.id).state).toBe('COMPLETED');
    expectTransitionAudit(
      env,
      settled.tx.id,
      'SETTLED',
      'COMPLETED',
      'TRANSACTION_COMPLETED',
    );
  });

  const returnTargets: TransactionState[] = [
    'AWAITING_FUNDING_CONFIRMATION',
    'FUNDED_CONFIRMED',
    'IN_FULFILMENT',
    'DELIVERED',
    'RECEIPT_CONFIRMED',
    'SETTLEMENT_PENDING',
  ];
  for (const target of returnTargets) {
    it(`row 22: DISPUTED -> ${target} (human PROCEED resolution restores pre-dispute state)`, () => {
      const env = createTestEnv();
      const disputed = toDisputed(env, draftTx(env), target);
      const resolver = fullStaffActor(env);
      env.txs.resolveDispute(disputed.tx.id, {
        outcome: 'PROCEED',
        resolution: 'Proceed as before',
        resolvedBy: resolver.id,
      });
      env.txs.transition(disputed.tx.id, resolver, target);
      expect(env.txs.getTransaction(disputed.tx.id).state).toBe(target);
      expectTransitionAudit(
        env,
        disputed.tx.id,
        'DISPUTED',
        target,
        'DISPUTE_RESOLVED_RETURNED',
      );
    });
  }

  it('row 23: DISPUTED -> REFUND_PENDING (human REFUND resolution)', () => {
    const env = createTestEnv();
    const disputed = toDisputed(env, draftTx(env), 'FUNDED_CONFIRMED');
    const resolver = fullStaffActor(env);
    env.txs.resolveDispute(disputed.tx.id, {
      outcome: 'REFUND',
      resolution: 'Refund agreed',
      resolvedBy: resolver.id,
    });
    env.txs.transition(disputed.tx.id, resolver, 'REFUND_PENDING');
    expect(env.txs.getTransaction(disputed.tx.id).state).toBe('REFUND_PENDING');
    expectTransitionAudit(
      env,
      disputed.tx.id,
      'DISPUTED',
      'REFUND_PENDING',
      'DISPUTE_RESOLVED_REFUND',
    );
  });

  it('row 24: DISPUTED -> CANCELLED (human CANCELLED resolution)', () => {
    const env = createTestEnv();
    const disputed = toDisputed(env, draftTx(env), 'FUNDED_CONFIRMED');
    const resolver = fullStaffActor(env);
    env.txs.resolveDispute(disputed.tx.id, {
      outcome: 'CANCELLED',
      resolution: 'Cancel agreed',
      resolvedBy: resolver.id,
    });
    env.txs.transition(disputed.tx.id, resolver, 'CANCELLED');
    expect(env.txs.getTransaction(disputed.tx.id).state).toBe('CANCELLED');
    expectTransitionAudit(
      env,
      disputed.tx.id,
      'DISPUTED',
      'CANCELLED',
      'DISPUTE_RESOLVED_CANCELLED',
    );
  });

  it('row 25: REFUND_PENDING -> REFUNDED (institution refund reference + confirmation)', () => {
    const env = createTestEnv();
    const refundPending = toRefundPending(env, draftTx(env));
    const recorder = staffActor(env, ALL_PERMISSIONS);
    env.txs.transition(refundPending.tx.id, recorder, 'REFUNDED', {
      refundConfirmation: {
        settlementReference: 'REF-POS-25',
        executedAmount: 1200,
        currency: 'USD',
        beneficiary: 'Buyer Name',
        receivingMethod: 'bank transfer',
        executionDate: '2026-11-02',
        confirmationDocument: 'refund-doc-25',
      },
    });
    expect(env.txs.getTransaction(refundPending.tx.id).state).toBe('REFUNDED');
    expectTransitionAudit(
      env,
      refundPending.tx.id,
      'REFUND_PENDING',
      'REFUNDED',
      'REFUND_RECORDED',
    );
  });

  it('row 26: REFUNDED -> COMPLETED', () => {
    const env = createTestEnv();
    const refunded = toRefunded(env, draftTx(env));
    const actor = fullStaffActor(env);
    env.txs.transition(refunded.tx.id, actor, 'COMPLETED');
    expect(env.txs.getTransaction(refunded.tx.id).state).toBe('COMPLETED');
    expectTransitionAudit(
      env,
      refunded.tx.id,
      'REFUNDED',
      'COMPLETED',
      'TRANSACTION_COMPLETED',
    );
  });
});
