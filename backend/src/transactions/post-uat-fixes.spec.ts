// Post-UAT fixes (parent decisions, client v3.1 requirements).
// D1 option (b): handover-acceptance is REJECTED while a product-absent
// exception is unresolved — no 201, no MessageLog, no acceptance record.
// OBS-1: a rejected beneficiary change from WhatsApp alone creates a
// dedicated FollowUpCase that changes nothing else.
// Uses the IN-MEMORY TEST DOUBLE only — NOT Prisma, NOT PostgreSQL.
import request from 'supertest';
import { DomainError } from '../common/errors';
import {
  createTestEnv,
  draftTx,
  fullStaffActor,
  toDelivered,
  toReceiptConfirmed,
} from '../testing/builders';
import { createHttpEnv, type HttpEnv } from '../testing/http';

let counter = 0;
const next = (): number => {
  counter += 1;
  return counter;
};

describe('UAT-D1 fix (option b): handover acceptance blocked by unresolved exception', () => {
  it('acceptance attempt while the exception is unresolved is rejected 422 with no message or acceptance record, and state stays DELIVERED', () => {
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
    const whatsappId = `waba-postuat-blocked-${next()}`;
    let thrown: unknown;
    try {
      env.txs.recordHandoverAcceptance(delivered.tx.id, whatsappId, delivered.buyer.id);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(DomainError);
    expect((thrown as DomainError).status).toBe(422);
    expect((thrown as DomainError).code).toBe('UNRESOLVED_HANDOVER_EXCEPTION');
    // Nothing was recorded by the rejected attempt.
    expect(env.store.findMessageLogByWhatsappId(whatsappId)).toBeUndefined();
    expect(
      env.store
        .auditForTransaction(delivered.tx.id)
        .filter((a) => a.action === 'BUYER_HANDOVER_ACCEPT'),
    ).toHaveLength(0);
    // The guarded transition is independently rejected; state unchanged.
    expect(() =>
      env.txs.transition(delivered.tx.id, actor, 'RECEIPT_CONFIRMED'),
    ).toThrow(DomainError);
    expect(env.txs.getTransaction(delivered.tx.id).state).toBe('DELIVERED');
  });

  it('after the exception is resolved and a real handover occurs, explicit ACCEPT works and reaches RECEIPT_CONFIRMED', () => {
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
    expect(() =>
      env.txs.recordHandoverAcceptance(
        delivered.tx.id,
        `waba-postuat-blocked-${next()}`,
        delivered.buyer.id,
      ),
    ).toThrow(DomainError);
    env.txs.resolveOperationalException(delivered.tx.id, actor.id);
    env.txs.recordDeliveryEvent(
      delivered.tx.id,
      'BUYER_ARRIVED_AT_HANDOVER',
      actor.id,
      'Buyer arrived again, product present',
    );
    env.txs.recordDeliveryEvent(
      delivered.tx.id,
      'HANDOVER_INSPECTION_COMPLETED',
      actor.id,
    );
    env.txs.recordHandoverAcceptance(
      delivered.tx.id,
      `waba-postuat-accept-${next()}`,
      delivered.buyer.id,
    );
    env.txs.transition(delivered.tx.id, actor, 'RECEIPT_CONFIRMED');
    expect(env.txs.getTransaction(delivered.tx.id).state).toBe(
      'RECEIPT_CONFIRMED',
    );
  });
});

describe('OBS-1: dedicated FollowUpCase for beneficiary discrepancy', () => {
  it('a rejected WhatsApp beneficiary change creates an OPEN case and changes no state, money, or beneficiary', () => {
    const env = createTestEnv();
    const receipt = toReceiptConfirmed(env, draftTx(env));
    const actor = fullStaffActor(env);
    const stateBefore = env.txs.getTransaction(receipt.tx.id).state;
    expect(() =>
      env.txs.transition(receipt.tx.id, actor, 'SETTLEMENT_PENDING', {
        settlementSummary: {
          deposit_reference: receipt.depositRef as string,
          amount: 1200,
          currency: 'USD',
          beneficiary_name: 'Someone Else',
          delivery_proof_or_dispute_outcome: 'Delivery proof: handover accepted',
        },
        beneficiaryChangedFromWhatsappMessage: true,
      }),
    ).toThrow(DomainError);
    const cases = env.txs.listFollowUpCases(receipt.tx.id);
    expect(cases).toHaveLength(1);
    expect(cases[0].type).toBe('BENEFICIARY_DISCREPANCY');
    expect(cases[0].status).toBe('OPEN');
    expect(cases[0].details).toContain('Someone Else');
    // No side effect on the transaction itself.
    expect(env.txs.getTransaction(receipt.tx.id).state).toBe(stateBefore);
    expect(env.store.settlementSummariesForTransaction(receipt.tx.id)).toHaveLength(0);
  });

  it('staff can resolve a case with resolution text and an audit event; a resolved case cannot be resolved again', () => {
    const env = createTestEnv();
    const receipt = toReceiptConfirmed(env, draftTx(env));
    const actor = fullStaffActor(env);
    expect(() =>
      env.txs.transition(receipt.tx.id, actor, 'SETTLEMENT_PENDING', {
        settlementSummary: {
          deposit_reference: receipt.depositRef as string,
          amount: 1200,
          currency: 'USD',
          beneficiary_name: 'Someone Else',
          delivery_proof_or_dispute_outcome: 'Delivery proof',
        },
        beneficiaryChangedFromWhatsappMessage: true,
      }),
    ).toThrow(DomainError);
    const followUpCase = env.txs.listFollowUpCases(receipt.tx.id)[0];
    const resolved = env.txs.resolveFollowUpCase(followUpCase.id, {
      resolution: 'Confirmed with the institution that the beneficiary is the seller on record; attempted WhatsApp value discarded.',
      resolvedBy: actor.id,
    });
    expect(resolved.status).toBe('RESOLVED');
    expect(resolved.resolution).toContain('discarded');
    expect(
      env.store
        .auditForTransaction(receipt.tx.id)
        .filter((a) => a.action === 'FOLLOW_UP_CASE_RESOLVED'),
    ).toHaveLength(1);
    expect(() =>
      env.txs.resolveFollowUpCase(followUpCase.id, {
        resolution: 'second attempt',
        resolvedBy: actor.id,
      }),
    ).toThrow(DomainError);
    // Resolving the case did not move the transaction.
    expect(env.txs.getTransaction(receipt.tx.id).state).toBe('RECEIPT_CONFIRMED');
  });

  it('follow-up cases are visible over HTTP and resolve over HTTP', async () => {
    const env: HttpEnv = await createHttpEnv();
    try {
      const { token } = env.fullToken();
      const server = env.app.getHttpServer();
      const post = (url: string, body: Record<string, unknown>, expected: number) =>
        request(server)
          .post(url)
          .set('Authorization', `Bearer ${token}`)
          .send(body)
          .expect(expected);
      const buyer = await post('/api/users', { whatsappNumber: `+967700030${String(next()).padStart(3, '0')}` }, 201);
      const seller = await post('/api/users', { whatsappNumber: `+967700031${String(next()).padStart(3, '0')}` }, 201);
      const tx = await post('/api/transactions', {
        amount: 1200, currency: 'USD', product_description: 'Test figurine set',
        quantity: 2, delivery_point: "Sana'a pickup point",
        cancellation_terms: 'Cancel before funding with both parties agreement',
        buyerUserId: buyer.body.id, sellerUserId: seller.body.id,
      }, 201);
      const txId = tx.body.id as string;
      await post(`/api/transactions/${txId}/contract-versions`, { content: 'contract content version 1' }, 201);
      const go = (to: string, body: Record<string, unknown> = {}, expected = 201) =>
        post(`/api/transactions/${txId}/transition`, { to, ...body }, expected);
      await go('PENDING_REVIEW');
      await post(`/api/transactions/${txId}/party-acceptance`, { partyRole: 'BUYER', whatsappMessageId: `waba-fu-b-${next()}` }, 201);
      await post(`/api/transactions/${txId}/party-acceptance`, { partyRole: 'SELLER', whatsappMessageId: `waba-fu-s-${next()}` }, 201);
      await go('ACCEPTED');
      await go('AWAITING_FUNDING_CONFIRMATION', { voucher: { buyerName: 'Buyer Name', sellerName: 'Seller Name', purpose: 'Purchase', amount: 1200, currency: 'USD', paymentReferenceText: 'PILOT-FU-PAYMENT' } });
      const depositRef = `DEP-FU-${next()}`;
      await post(`/api/transactions/${txId}/coordination`, { contactMethod: 'manual phone call', institutionResponse: 'Deposit booked', depositReference: depositRef, institutionConfirmed: true }, 201);
      await go('FUNDED_CONFIRMED');
      await go('IN_FULFILMENT', { shippingConfirmed: true });
      await post(`/api/transactions/${txId}/delivery-events`, { eventType: 'SELLER_ARRIVED_AT_DELIVERY_POINT', note: 'arrived' }, 201);
      await go('DELIVERED');
      await post(`/api/transactions/${txId}/delivery-events`, { eventType: 'BUYER_ARRIVED_AT_HANDOVER' }, 201);
      await post(`/api/transactions/${txId}/delivery-events`, { eventType: 'HANDOVER_INSPECTION_COMPLETED' }, 201);
      await post(`/api/transactions/${txId}/handover-acceptance`, { whatsappMessageId: `waba-fu-accept-${next()}`, buyerUserId: buyer.body.id }, 201);
      await go('RECEIPT_CONFIRMED');
      const bad = await go('SETTLEMENT_PENDING', {
        settlementSummary: { deposit_reference: depositRef, amount: 1200, currency: 'USD', beneficiary_name: 'Someone Else', delivery_proof_or_dispute_outcome: 'Delivery proof' },
        beneficiaryChangedFromWhatsappMessage: true,
      }, 422);
      expect(bad.body.code).toBe('GUARD_FAILED');
      const list = await request(server)
        .get(`/api/transactions/${txId}/follow-up-cases`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0].type).toBe('BENEFICIARY_DISCREPANCY');
      expect(list.body[0].status).toBe('OPEN');
      const resolved = await post(`/api/transactions/${txId}/follow-up-cases/${list.body[0].id}/resolve`, { resolution: 'Institution confirmed the seller on record; WhatsApp value discarded.' }, 201);
      expect(resolved.body.status).toBe('RESOLVED');
      const detail = await request(server)
        .get(`/api/transactions/${txId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(detail.body.transaction.state).toBe('RECEIPT_CONFIRMED');
    } finally {
      await env.close();
    }
  });
});
