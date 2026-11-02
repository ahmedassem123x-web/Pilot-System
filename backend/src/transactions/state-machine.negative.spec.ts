// PB-08 negative tests: every forbidden transition is rejected with a
// clear error code AND an AuditEvent, and every Guard element missing
// is rejected (permission missing => 403). Uses the IN-MEMORY TEST
// DOUBLE only (see in-memory.store.ts header) — not live results.
import { DomainError } from '../common/errors';
import {
  TRANSACTION_STATES,
  TransactionState,
} from '../common/transaction-state';
import { TRANSITION_TABLE, findTransitionRow } from './transition-table';
import type { TransitionInput } from './transactions.service';
import {
  createTestEnv,
  draftTx,
  fullStaffActor,
  settlementSummaryInput,
  staffActor,
  toAccepted,
  toAwaiting,
  toDisputed,
  toFunded,
  toInFulfilment,
  toPendingReview,
  toReceiptConfirmed,
  toRefundPending,
  toSettled,
  toSettlementPending,
  txInput,
  voucherInput,
  walkTo,
  TestEnv,
  TxContext,
} from '../testing/builders';

function generousInput(ctx: TxContext): TransitionInput {
  return {
    cancellationReason: 'test cancellation',
    bothPartiesAgreement: true,
    buyerApprovedAmendment: true,
    sellerApprovedAmendment: true,
    newContractContent: 'amended content',
    voucher: voucherInput(),
    shippingConfirmed: true,
    disputeReason: 'test dispute',
    disputeEvidenceFileIds: ['f1'],
    settlementSummary: ctx.depositRef
      ? settlementSummaryInput(ctx)
      : undefined,
    refundConfirmation: {
      settlementReference: 'REF-NEG-1',
      executedAmount: 1200,
      currency: 'USD',
      beneficiary: 'Buyer Name',
      receivingMethod: 'bank transfer',
      executionDate: '2026-11-02',
      confirmationDocument: 'doc-1',
    },
  };
}

function expectRejection(
  env: TestEnv,
  ctx: TxContext,
  error: unknown,
  code: string,
  from: TransactionState,
  to: TransactionState,
): void {
  expect(error).toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe(code);
  expect(env.txs.getTransaction(ctx.tx.id).state).toBe(from);
  const rejections = env.store
    .auditForTransaction(ctx.tx.id)
    .filter(
      (a) =>
        a.action === 'TRANSITION_REJECTED' &&
        a.previous_state === from &&
        a.new_state === to,
    );
  expect(rejections.length).toBeGreaterThanOrEqual(1);
  expect(rejections[rejections.length - 1].details).toMatchObject({
    code,
  });
}

describe('PB-08 negative: forbidden transitions + missing Guards', () => {
  it('transition table has exactly 26 rows (matrix §3 row count)', () => {
    expect(TRANSITION_TABLE).toHaveLength(26);
  });

  it('concrete-pair reconciliation: 31 allowed pairs, 179 unconditionally forbidden (matrix counts row 22 once => 184)', () => {
    // 25 fixed pairs + 6 row-22 return targets = 31 concrete pairs.
    const fixed = TRANSITION_TABLE.filter(
      (row) => row.to !== 'PRE_DISPUTE_STATE',
    ).length;
    expect(fixed).toBe(25);
    const concreteAllowed = fixed + 6;
    expect(concreteAllowed).toBe(31);
    expect(15 * 14 - concreteAllowed).toBe(179);
    // The matrix's "184" = 210 - 26 rows (row 22 counted once).
    expect(15 * 14 - TRANSITION_TABLE.length).toBe(184);
  });

  it('every forbidden ordered pair is rejected with FORBIDDEN_TRANSITION + audit entry', () => {
    for (const from of TRANSACTION_STATES) {
      const env = createTestEnv();
      const base = walkTo(env, draftTx(env), from);
      for (const to of TRANSACTION_STATES) {
        if (to === from) continue;
        if (from === 'DISPUTED') continue; // handled separately below
        if (findTransitionRow(from, to)) continue; // allowed: positive spec
        const actor = fullStaffActor(env);
        const before = env.store.auditForTransaction(base.tx.id).length;
        let caught: unknown;
        try {
          env.txs.transition(base.tx.id, actor, to, generousInput(base));
        } catch (error) {
          caught = error;
        }
        expectRejection(env, base, caught, 'FORBIDDEN_TRANSITION', from, to);
        expect(env.store.auditForTransaction(base.tx.id).length).toBe(
          before + 1,
        );
      }
    }
  });

  it('DISPUTED exits other than rows 22/23/24 are rejected, including wrong-target returns', () => {
    for (const to of TRANSACTION_STATES) {
      if (to === 'DISPUTED') continue;
      const env = createTestEnv();
      // Pre-dispute state here is FUNDED_CONFIRMED (walkTo DISPUTED).
      const disputed = walkTo(env, draftTx(env), 'DISPUTED');
      const resolver = fullStaffActor(env);
      const outcome =
        to === 'REFUND_PENDING'
          ? 'REFUND'
          : to === 'CANCELLED'
            ? 'CANCELLED'
            : 'PROCEED';
      env.txs.resolveDispute(disputed.tx.id, {
        outcome,
        resolution: 'test resolution',
        resolvedBy: resolver.id,
      });
      const allowed =
        to === 'FUNDED_CONFIRMED' || to === 'REFUND_PENDING' || to === 'CANCELLED';
      let caught: unknown;
      try {
        env.txs.transition(disputed.tx.id, resolver, to, generousInput(disputed));
      } catch (error) {
        caught = error;
      }
      if (allowed) {
        expect(caught).toBeUndefined();
        expect(env.txs.getTransaction(disputed.tx.id).state).toBe(to);
      } else {
        expect(caught).toBeInstanceOf(DomainError);
        expect(env.txs.getTransaction(disputed.tx.id).state).toBe('DISPUTED');
        const rejections = env.store
          .auditForTransaction(disputed.tx.id)
          .filter((a) => a.action === 'TRANSITION_REJECTED');
        expect(rejections.length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('every self-transition is rejected as a no-op + audited', () => {
    for (const state of TRANSACTION_STATES) {
      const env = createTestEnv();
      const ctx = walkTo(env, draftTx(env), state);
      const actor = fullStaffActor(env);
      let caught: unknown;
      try {
        env.txs.transition(ctx.tx.id, actor, state, {});
      } catch (error) {
        caught = error;
      }
      expectRejection(env, ctx, caught, 'SELF_TRANSITION', state, state);
    }
  });

  it('permission missing => 403 PERMISSION_DENIED + audit entry', () => {
    const env = createTestEnv();
    const ctx = draftTx(env);
    const actor = staffActor(env, []); // no permissions at all
    let caught: unknown;
    try {
      env.txs.transition(ctx.tx.id, actor, 'PENDING_REVIEW');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DomainError);
    expect((caught as DomainError).code).toBe('PERMISSION_DENIED');
    expect((caught as DomainError).status).toBe(403);
    expectRejection(env, ctx, caught, 'PERMISSION_DENIED', 'DRAFT', 'PENDING_REVIEW');
  });

  it('row 1 Guard: submit with only one party is rejected', () => {
    const env = createTestEnv();
    const tx = env.txs.createTransaction(txInput());
    const buyer = env.users.createPerson('+967779999991');
    env.store.addParty(tx.id, buyer.id, 'BUYER');
    env.txs.createContractVersion(tx.id, 'content');
    const actor = fullStaffActor(env);
    let caught: unknown;
    try {
      env.txs.transition(tx.id, actor, 'PENDING_REVIEW');
    } catch (error) {
      caught = error;
    }
    expect((caught as DomainError).code).toBe('GUARD_FAILED');
  });

  it('row 2/4 Guard: cancellation without a reason is rejected', () => {
    const env = createTestEnv();
    const ctx = draftTx(env);
    const actor = fullStaffActor(env);
    expect(() =>
      env.txs.transition(ctx.tx.id, actor, 'CANCELLED', {}),
    ).toThrow(DomainError);
    const pending = toPendingReview(env, draftTx(env));
    expect(() =>
      env.txs.transition(pending.tx.id, actor, 'CANCELLED', {}),
    ).toThrow(DomainError);
  });

  it('row 3 Guard: acceptance with no party acceptances is rejected', () => {
    const env = createTestEnv();
    const pending = toPendingReview(env, draftTx(env));
    const actor = fullStaffActor(env);
    expect(() =>
      env.txs.transition(pending.tx.id, actor, 'ACCEPTED'),
    ).toThrow(DomainError);
  });

  it('row 5 Guard: amendment without both approvals, or without new content, is rejected', () => {
    const env = createTestEnv();
    const accepted = toAccepted(env, draftTx(env));
    const actor = fullStaffActor(env);
    expect(() =>
      env.txs.transition(accepted.tx.id, actor, 'PENDING_REVIEW', {
        buyerApprovedAmendment: true,
        sellerApprovedAmendment: false,
        newContractContent: 'v2',
      }),
    ).toThrow(DomainError);
    expect(() =>
      env.txs.transition(accepted.tx.id, actor, 'PENDING_REVIEW', {
        buyerApprovedAmendment: true,
        sellerApprovedAmendment: true,
      }),
    ).toThrow(DomainError);
    expect(env.txs.getTransaction(accepted.tx.id).state).toBe('ACCEPTED');
  });

  it('row 6 Guard: voucher missing or incomplete is rejected', () => {
    const env = createTestEnv();
    const accepted = toAccepted(env, draftTx(env));
    const actor = fullStaffActor(env);
    expect(() =>
      env.txs.transition(accepted.tx.id, actor, 'AWAITING_FUNDING_CONFIRMATION', {}),
    ).toThrow(DomainError);
    expect(() =>
      env.txs.transition(accepted.tx.id, actor, 'AWAITING_FUNDING_CONFIRMATION', {
        voucher: { ...voucherInput(), paymentReferenceText: '' },
      }),
    ).toThrow(DomainError);
  });

  it('row 7/10 Guard: cancellation without both parties agreement is rejected', () => {
    const env = createTestEnv();
    const accepted = toAccepted(env, draftTx(env));
    const actor = fullStaffActor(env);
    expect(() =>
      env.txs.transition(accepted.tx.id, actor, 'CANCELLED', {
        cancellationReason: 'no agreement recorded',
      }),
    ).toThrow(DomainError);
    const awaiting = toAwaiting(env, draftTx(env));
    expect(() =>
      env.txs.transition(awaiting.tx.id, actor, 'CANCELLED', {
        cancellationReason: 'no agreement recorded',
        bothPartiesAgreement: false,
      }),
    ).toThrow(DomainError);
  });

  it('row 8 Guard: funding without confirmation, without deposit reference, or without coordination is rejected', () => {
    const env = createTestEnv();
    const actor = fullStaffActor(env);
    const noCoord = toAwaiting(env, draftTx(env));
    expect(() =>
      env.txs.transition(noCoord.tx.id, actor, 'FUNDED_CONFIRMED'),
    ).toThrow(DomainError);

    const noRef = toAwaiting(env, draftTx(env));
    env.txs.recordCoordination({
      transactionId: noRef.tx.id,
      staffId: actor.id,
      contactMethod: 'manual',
      institutionConfirmed: true,
    });
    expect(() =>
      env.txs.transition(noRef.tx.id, actor, 'FUNDED_CONFIRMED'),
    ).toThrow(DomainError);

    const notConfirmed = toAwaiting(env, draftTx(env));
    env.txs.recordCoordination({
      transactionId: notConfirmed.tx.id,
      staffId: actor.id,
      contactMethod: 'manual',
      depositReference: 'DEP-NEG-NOCONF',
      institutionConfirmed: false,
    });
    expect(() =>
      env.txs.transition(notConfirmed.tx.id, actor, 'FUNDED_CONFIRMED'),
    ).toThrow(DomainError);
  });

  it('row 11 Guard: fulfilment without shipping confirmation is rejected', () => {
    const env = createTestEnv();
    const funded = toFunded(env, draftTx(env));
    const actor = fullStaffActor(env);
    expect(() =>
      env.txs.transition(funded.tx.id, actor, 'IN_FULFILMENT', {}),
    ).toThrow(DomainError);
  });

  it('row 13 Guard: delivery without seller arrival event is rejected', () => {
    const env = createTestEnv();
    const fulfil = toInFulfilment(env, draftTx(env));
    const actor = fullStaffActor(env);
    expect(() =>
      env.txs.transition(fulfil.tx.id, actor, 'DELIVERED'),
    ).toThrow(DomainError);
  });

  it('row 17 Guard: settlement summary with mismatched deposit reference or missing beneficiary is rejected', () => {
    const env = createTestEnv();
    const receipt = toReceiptConfirmed(env, draftTx(env));
    const actor = fullStaffActor(env);
    expect(() =>
      env.txs.transition(receipt.tx.id, actor, 'SETTLEMENT_PENDING', {
        settlementSummary: {
          ...settlementSummaryInput(receipt),
          deposit_reference: 'DEP-WRONG',
        },
      }),
    ).toThrow(DomainError);
    expect(() =>
      env.txs.transition(receipt.tx.id, actor, 'SETTLEMENT_PENDING', {
        settlementSummary: {
          ...settlementSummaryInput(receipt),
          beneficiary_name: '',
        },
      }),
    ).toThrow(DomainError);
    expect(() =>
      env.txs.transition(receipt.tx.id, actor, 'SETTLEMENT_PENDING', {
        settlementSummary: settlementSummaryInput(receipt),
        beneficiaryChangedFromWhatsappMessage: true,
      }),
    ).toThrow(DomainError);
  });

  it('row 19 Guard: settlement without institution confirmation is rejected', () => {
    const env = createTestEnv();
    const pending = toSettlementPending(env, draftTx(env));
    const actor = fullStaffActor(env);
    expect(() =>
      env.txs.transition(pending.tx.id, actor, 'SETTLED'),
    ).toThrow(DomainError);
  });

  it('row 22 Guard: return without a resolved dispute, or to a non-pre-dispute target, is rejected', () => {
    const env = createTestEnv();
    const disputed = toDisputed(env, draftTx(env), 'FUNDED_CONFIRMED');
    const actor = fullStaffActor(env);
    expect(() =>
      env.txs.transition(disputed.tx.id, actor, 'FUNDED_CONFIRMED'),
    ).toThrow(DomainError);
    const resolver = fullStaffActor(env);
    env.txs.resolveDispute(disputed.tx.id, {
      outcome: 'PROCEED',
      resolution: 'proceed',
      resolvedBy: resolver.id,
    });
    expect(() =>
      env.txs.transition(disputed.tx.id, resolver, 'DELIVERED'),
    ).toThrow(DomainError);
    expect(env.txs.getTransaction(disputed.tx.id).state).toBe('DISPUTED');
  });

  it('row 23 Guard: refund exit requires a REFUND outcome (PROCEED is rejected)', () => {
    const env = createTestEnv();
    const disputed = toDisputed(env, draftTx(env), 'FUNDED_CONFIRMED');
    const resolver = fullStaffActor(env);
    env.txs.resolveDispute(disputed.tx.id, {
      outcome: 'PROCEED',
      resolution: 'proceed',
      resolvedBy: resolver.id,
    });
    expect(() =>
      env.txs.transition(disputed.tx.id, resolver, 'REFUND_PENDING'),
    ).toThrow(DomainError);
  });

  it('row 25 Guard: refund without a confirmation document is rejected', () => {
    const env = createTestEnv();
    const refundPending = toRefundPending(env, draftTx(env));
    const actor = fullStaffActor(env);
    expect(() =>
      env.txs.transition(refundPending.tx.id, actor, 'REFUNDED', {
        refundConfirmation: {
          settlementReference: 'REF-NEG-2',
          executedAmount: 1200,
          currency: 'USD',
          beneficiary: 'Buyer Name',
          executionDate: '2026-11-02',
          confirmationDocument: '',
        },
      }),
    ).toThrow(DomainError);
  });

  it('terminal states have no outgoing transition', () => {
    const env = createTestEnv();
    const settled = toSettled(env, draftTx(env));
    const actor = fullStaffActor(env);
    env.txs.transition(settled.tx.id, actor, 'COMPLETED');
    for (const to of TRANSACTION_STATES) {
      if (to === 'COMPLETED') continue;
      expect(() =>
        env.txs.transition(settled.tx.id, actor, to, generousInput(settled)),
      ).toThrow(DomainError);
    }
    const cancelled = draftTx(env);
    env.txs.transition(cancelled.tx.id, actor, 'CANCELLED', {
      cancellationReason: 'test',
    });
    for (const to of TRANSACTION_STATES) {
      if (to === 'CANCELLED') continue;
      expect(() =>
        env.txs.transition(cancelled.tx.id, actor, to, generousInput(cancelled)),
      ).toThrow(DomainError);
    }
  });
});
