// Pilot System v3.1 — Sprint 4 regression test for the Sprint 3
// finding (docs/sprint-3-report.md): the DISPUTED -> REFUND_PENDING
// Guard (DISPUTE_RESOLVED_REFUND) used to reject when ANY audit row
// had new_state === 'SETTLED' — including a TRANSITION_REJECTED audit
// from a correctly-rejected settlement attempt while DISPUTED. That
// poisoned a later legitimate refund path. The fix counts ONLY
// successful settlements: action === 'SETTLEMENT_RECORDED' with
// new_state === 'SETTLED'. This spec proves the full sequence on ONE
// transaction: rejected settlement while DISPUTED, then human
// resolution to REFUND_PENDING, then refund with an institution
// reference, succeeds end to end.
import {
  createTestEnv,
  draftTx,
  fullStaffActor,
  staffActor,
  ALL_PERMISSIONS,
  toSettlementPending,
} from '../testing/builders';

describe('Sprint 4 Guard fix: rejected settlement attempt must not block a later legitimate refund', () => {
  it('rejected SETTLED attempt while DISPUTED, then human resolution to REFUND_PENDING, then refund with institution reference, succeeds', () => {
    const env = createTestEnv();
    const pending = toSettlementPending(env, draftTx(env));
    const txId = pending.tx.id;

    // Open a dispute from SETTLEMENT_PENDING (settlement freezes).
    const opener = fullStaffActor(env);
    env.txs.transition(txId, opener, 'DISPUTED', {
      disputeReason: 'Buyer disputes delivery condition',
      disputeEvidenceFileIds: ['evidence-file-1'],
    });
    expect(env.txs.getTransaction(txId).state).toBe('DISPUTED');

    // Correctly-rejected settlement attempt while DISPUTED. This
    // writes a TRANSITION_REJECTED audit with new_state SETTLED —
    // the row that used to poison the refund Guard.
    const settler = fullStaffActor(env);
    expect(() =>
      env.txs.transition(txId, settler, 'SETTLED'),
    ).toThrow('DISPUTED -> SETTLED');
    const rejectedAudits = env.store
      .auditForTransaction(txId)
      .filter(
        (a) => a.action === 'TRANSITION_REJECTED' && a.new_state === 'SETTLED',
      );
    expect(rejectedAudits.length).toBeGreaterThanOrEqual(1);

    // Human resolution to REFUND (the legitimate path). Before the
    // fix this threw GUARD_FAILED ("Refund path is unavailable after
    // settlement executed"); after the fix it succeeds.
    const resolver = fullStaffActor(env);
    env.txs.resolveDispute(txId, {
      outcome: 'REFUND',
      resolution: 'Refund agreed by human resolution after dispute',
      resolvedBy: resolver.id,
    });
    env.txs.transition(txId, resolver, 'REFUND_PENDING');
    expect(env.txs.getTransaction(txId).state).toBe('REFUND_PENDING');

    // Refund with an institution settlement/refund reference, by a
    // recorder who differs from the funding confirmer (SoD).
    const recorder = staffActor(env, ALL_PERMISSIONS);
    expect(recorder.id).not.toBe(pending.fundingStaffId);
    env.txs.transition(txId, recorder, 'REFUNDED', {
      refundConfirmation: {
        settlementReference: 'REF-REGRESSION-1',
        executedAmount: 1200,
        currency: 'USD',
        beneficiary: 'Buyer Name',
        receivingMethod: 'bank transfer',
        executionDate: '2026-11-02',
        confirmationDocument: 'refund-confirmation-doc-regression',
      },
    });
    expect(env.txs.getTransaction(txId).state).toBe('REFUNDED');

    // And the refund route can complete (no open dispute remains).
    const closer = fullStaffActor(env);
    env.txs.transition(txId, closer, 'COMPLETED');
    expect(env.txs.getTransaction(txId).state).toBe('COMPLETED');
  });

  it('still blocks nothing it should not: a rejected attempt alone never creates a SETTLEMENT_RECORDED audit', () => {
    const env = createTestEnv();
    const pending = toSettlementPending(env, draftTx(env));
    const txId = pending.tx.id;
    const opener = fullStaffActor(env);
    env.txs.transition(txId, opener, 'DISPUTED', {
      disputeReason: 'Test dispute',
      disputeEvidenceFileIds: [],
    });
    expect(() =>
      env.txs.transition(txId, fullStaffActor(env), 'SETTLED'),
    ).toThrow();
    const successfulSettlements = env.store
      .auditForTransaction(txId)
      .filter(
        (a) => a.action === 'SETTLEMENT_RECORDED' && a.new_state === 'SETTLED',
      );
    expect(successfulSettlements).toHaveLength(0);
  });
});
