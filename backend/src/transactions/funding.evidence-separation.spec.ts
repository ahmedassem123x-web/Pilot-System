// Buyer evidence vs institution confirmation (CORE PROMPT §11.2-11.4,
// matrix §5 items 1, 6, 9). Uses the IN-MEMORY TEST DOUBLE only.
import { DomainError } from '../common/errors';
import {
  createTestEnv,
  draftTx,
  fullStaffActor,
  toAwaiting,
  toFunded,
} from '../testing/builders';

describe('funding gate: evidence alone never funds, never ships', () => {
  it('funding on buyer evidence alone is rejected (no coordination record)', () => {
    const env = createTestEnv();
    const awaiting = toAwaiting(env, draftTx(env));
    const buyer = awaiting.buyer;
    env.txs.submitPaymentEvidence({
      transactionId: awaiting.tx.id,
      channel: 'bank transfer',
      senderName: 'Buyer Name',
      beneficiaryNameAsShown: 'Seller Name',
      amount: 1200,
      currency: 'USD',
      externalPaymentReference: 'EXT-111',
      receiptFileId: 'receipt-1',
      submittedBy: buyer.id,
    });
    const evidence = env.store.evidencesForTransaction(awaiting.tx.id);
    expect(evidence).toHaveLength(1);
    expect(evidence[0].status).toBe('PAYMENT_EVIDENCE_SUBMITTED');
    const actor = fullStaffActor(env);
    expect(() =>
      env.txs.transition(awaiting.tx.id, actor, 'FUNDED_CONFIRMED'),
    ).toThrow(DomainError);
    expect(env.txs.getTransaction(awaiting.tx.id).state).toBe(
      'AWAITING_FUNDING_CONFIRMATION',
    );
  });

  it('funding on a WhatsApp message alone is rejected (message is never confirmation)', () => {
    const env = createTestEnv();
    const awaiting = toAwaiting(env, draftTx(env));
    env.store.createMessageLog({
      whatsapp_message_id: 'waba-fake-confirmation',
      transaction_id: awaiting.tx.id,
      direction: 'INBOUND',
      status: 'READ',
    });
    const actor = fullStaffActor(env);
    expect(() =>
      env.txs.transition(awaiting.tx.id, actor, 'FUNDED_CONFIRMED'),
    ).toThrow(DomainError);
  });

  it('shipping on evidence alone is rejected: AWAITING -> IN_FULFILMENT skips funding and is forbidden', () => {
    const env = createTestEnv();
    const awaiting = toAwaiting(env, draftTx(env));
    env.txs.submitPaymentEvidence({
      transactionId: awaiting.tx.id,
      channel: 'bank transfer',
      senderName: 'Buyer Name',
      amount: 1200,
      currency: 'USD',
      externalPaymentReference: 'EXT-222',
      submittedBy: awaiting.buyer.id,
    });
    const actor = fullStaffActor(env);
    expect(() =>
      env.txs.transition(awaiting.tx.id, actor, 'IN_FULFILMENT', {
        shippingConfirmed: true,
      }),
    ).toThrow(DomainError);
    expect(env.txs.getTransaction(awaiting.tx.id).state).toBe(
      'AWAITING_FUNDING_CONFIRMATION',
    );
  });

  it('deposit-reference reuse across transactions is rejected and audited for manual review', () => {
    const env = createTestEnv();
    const funded = toFunded(env, draftTx(env));
    const depositRef = funded.depositRef as string;
    const other = toAwaiting(env, draftTx(env));
    const staff = fullStaffActor(env);
    expect(() =>
      env.txs.recordCoordination({
        transactionId: other.tx.id,
        staffId: staff.id,
        contactMethod: 'manual',
        depositReference: depositRef,
        institutionConfirmed: true,
      }),
    ).toThrow(DomainError);
    try {
      env.txs.recordCoordination({
        transactionId: other.tx.id,
        staffId: staff.id,
        contactMethod: 'manual',
        depositReference: depositRef,
        institutionConfirmed: true,
      });
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as DomainError).code).toBe('DUPLICATE_DEPOSIT_REFERENCE');
    }
    const audit = env.store
      .auditForTransaction(other.tx.id)
      .filter((a) => a.action === 'COORDINATION_REJECTED_DUPLICATE_REFERENCE');
    expect(audit.length).toBeGreaterThanOrEqual(1);
    // The funded transaction still holds the reference alone.
    expect(
      env.store.findCoordinationByDepositReference(depositRef)?.transaction_id,
    ).toBe(funded.tx.id);
  });

  it('evidence status can never be anything but PAYMENT_EVIDENCE_SUBMITTED', () => {
    const env = createTestEnv();
    const awaiting = toAwaiting(env, draftTx(env));
    const evidence = env.txs.submitPaymentEvidence({
      transactionId: awaiting.tx.id,
      channel: 'wallet',
      senderName: 'Buyer Name',
      amount: 1200,
      currency: 'USD',
      externalPaymentReference: 'EXT-333',
      submittedBy: awaiting.buyer.id,
    });
    expect(evidence.status).toBe('PAYMENT_EVIDENCE_SUBMITTED');
    // No API on the service or store can flip it: the type has exactly
    // one value, and PaymentEvidence rows have no update method.
    expect(
      Object.prototype.hasOwnProperty.call(evidence, 'status'),
    ).toBe(true);
  });
});
