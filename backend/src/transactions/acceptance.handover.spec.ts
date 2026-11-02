// Sold as Seen handover (CORE PROMPT §9, matrix §6): explicit
// accept/reject only, exact event order, no time/silence acceptance.
// Uses the IN-MEMORY TEST DOUBLE only.
import { DomainError } from '../common/errors';
import {
  createTestEnv,
  draftTx,
  fullStaffActor,
  toDelivered,
} from '../testing/builders';

describe('Sold as Seen handover', () => {
  it('acceptance without BUYER_ARRIVED_AT_HANDOVER is rejected', () => {
    const env = createTestEnv();
    const delivered = toDelivered(env, draftTx(env));
    const actor = fullStaffActor(env);
    env.txs.recordDeliveryEvent(
      delivered.tx.id,
      'HANDOVER_INSPECTION_COMPLETED',
      actor.id,
    );
    env.txs.recordHandoverAcceptance(
      delivered.tx.id,
      'waba-handover-no-arrival',
      delivered.buyer.id,
    );
    expect(() =>
      env.txs.transition(delivered.tx.id, actor, 'RECEIPT_CONFIRMED'),
    ).toThrow(DomainError);
  });

  it('acceptance without HANDOVER_INSPECTION_COMPLETED is rejected', () => {
    const env = createTestEnv();
    const delivered = toDelivered(env, draftTx(env));
    const actor = fullStaffActor(env);
    env.txs.recordDeliveryEvent(
      delivered.tx.id,
      'BUYER_ARRIVED_AT_HANDOVER',
      actor.id,
    );
    env.txs.recordHandoverAcceptance(
      delivered.tx.id,
      'waba-handover-no-inspection',
      delivered.buyer.id,
    );
    expect(() =>
      env.txs.transition(delivered.tx.id, actor, 'RECEIPT_CONFIRMED'),
    ).toThrow(DomainError);
  });

  it('acceptance without an explicit buyer ACCEPT record is rejected', () => {
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
    expect(() =>
      env.txs.transition(delivered.tx.id, actor, 'RECEIPT_CONFIRMED'),
    ).toThrow(DomainError);
  });

  it('acceptance after an unresolved product-absent exception is rejected', () => {
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
      'OPERATIONAL_EXCEPTION_PRODUCT_ABSENT',
      actor.id,
      'Buyer arrived, product was NOT there',
    );
    env.txs.recordDeliveryEvent(
      delivered.tx.id,
      'HANDOVER_INSPECTION_COMPLETED',
      actor.id,
    );
    env.txs.recordHandoverAcceptance(
      delivered.tx.id,
      'waba-handover-exception',
      delivered.buyer.id,
    );
    expect(() =>
      env.txs.transition(delivered.tx.id, actor, 'RECEIPT_CONFIRMED'),
    ).toThrow(DomainError);
    // The exception advances NO state and is not receipt/acceptance.
    expect(env.txs.getTransaction(delivered.tx.id).state).toBe('DELIVERED');
  });

  it('acceptance succeeds after staff resolve the product-absent exception and a real handover occurs', () => {
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
      'OPERATIONAL_EXCEPTION_PRODUCT_ABSENT',
      actor.id,
      'Product absent at first arrival',
    );
    env.txs.resolveOperationalException(delivered.tx.id, actor.id);
    env.txs.recordDeliveryEvent(
      delivered.tx.id,
      'HANDOVER_INSPECTION_COMPLETED',
      actor.id,
    );
    env.txs.recordHandoverAcceptance(
      delivered.tx.id,
      'waba-handover-resolved',
      delivered.buyer.id,
    );
    env.txs.transition(delivered.tx.id, actor, 'RECEIPT_CONFIRMED');
    expect(env.txs.getTransaction(delivered.tx.id).state).toBe(
      'RECEIPT_CONFIRMED',
    );
  });

  it('buyer REJECT at handover opens a dispute and does NOT auto-refund', () => {
    const env = createTestEnv();
    const delivered = toDelivered(env, draftTx(env));
    const actor = fullStaffActor(env);
    env.txs.transition(delivered.tx.id, actor, 'DISPUTED', {
      disputeReason: 'Buyer rejects product at handover',
      disputeEvidenceFileIds: ['reject-photo-1'],
    });
    expect(env.txs.getTransaction(delivered.tx.id).state).toBe('DISPUTED');
    expect(
      env.store.disputesForTransaction(delivered.tx.id)[0].status,
    ).toBe('OPEN');
    // No refund state was reached: refund still requires rows 23+25.
    expect(env.txs.getTransaction(delivered.tx.id).state).not.toBe(
      'REFUND_PENDING',
    );
  });

  it('DELIVERED is arrival at the point, NOT buyer acceptance', () => {
    const env = createTestEnv();
    const delivered = toDelivered(env, draftTx(env));
    expect(delivered.tx.state).toBe('DELIVERED');
    const receiptAudit = env.store
      .auditForTransaction(delivered.tx.id)
      .filter((a) => a.action === 'RECEIPT_CONFIRMED_BY_BUYER');
    expect(receiptAudit).toHaveLength(0);
  });
});
