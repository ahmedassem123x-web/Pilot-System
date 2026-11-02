// Pilot System v3.1 — Sprint 3 HTTP tests (PB-21, PB-22).
// Dispute freezing + Sold-as-Seen handover, exercised over HTTP.
// Test double only (see transactions.http.spec.ts header).
import request from 'supertest';
import { createHttpEnv, type HttpEnv } from '../testing/http';

let counter = 1000;
const next = (): number => {
  counter += 1;
  return counter;
};

const txBody = () => ({
  amount: 1200,
  currency: 'USD',
  product_description: 'Test figurine set',
  quantity: 2,
  delivery_point: "Sana'a pickup point",
  cancellation_terms: 'Cancel before funding with both parties agreement',
});

async function setupTx(env: HttpEnv, token: string): Promise<{ txId: string; buyerId: string }> {
  const server = env.app.getHttpServer();
  const buyer = await request(server)
    .post('/api/users')
    .set('Authorization', `Bearer ${token}`)
    .send({ whatsappNumber: `+967700020${String(next()).padStart(3, '0')}` })
    .expect(201);
  const seller = await request(server)
    .post('/api/users')
    .set('Authorization', `Bearer ${token}`)
    .send({ whatsappNumber: `+967700021${String(next()).padStart(3, '0')}` })
    .expect(201);
  const tx = await request(server)
    .post('/api/transactions')
    .set('Authorization', `Bearer ${token}`)
    .send({ ...txBody(), buyerUserId: buyer.body.id, sellerUserId: seller.body.id })
    .expect(201);
  await request(server)
    .post(`/api/transactions/${tx.body.id}/contract-versions`)
    .set('Authorization', `Bearer ${token}`)
    .send({ content: 'contract content version 1' })
    .expect(201);
  return { txId: tx.body.id, buyerId: buyer.body.id };
}

async function go(
  env: HttpEnv,
  token: string,
  txId: string,
  body: Record<string, unknown>,
  expected = 201,
): Promise<request.Response> {
  return request(env.app.getHttpServer())
    .post(`/api/transactions/${txId}/transition`)
    .set('Authorization', `Bearer ${token}`)
    .send(body)
    .expect(expected);
}

async function stateOf(env: HttpEnv, token: string, txId: string): Promise<string> {
  const res = await request(env.app.getHttpServer())
    .get(`/api/transactions/${txId}`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  return (res.body.transaction as { state: string }).state;
}

async function toDelivered(env: HttpEnv, token: string): Promise<{ txId: string; buyerId: string }> {
  const ctx = await setupTx(env, token);
  const server = env.app.getHttpServer();
  await go(env, token, ctx.txId, { to: 'PENDING_REVIEW' });
  for (const role of ['BUYER', 'SELLER']) {
    await request(server)
      .post(`/api/transactions/${ctx.txId}/party-acceptance`)
      .set('Authorization', `Bearer ${token}`)
      .send({ partyRole: role, whatsappMessageId: `waba-dh-${next()}` })
      .expect(201);
  }
  await go(env, token, ctx.txId, { to: 'ACCEPTED' });
  await go(env, token, ctx.txId, {
    to: 'AWAITING_FUNDING_CONFIRMATION',
    voucher: {
      buyerName: 'Buyer Name',
      sellerName: 'Seller Name',
      purpose: 'Purchase',
      amount: 1200,
      currency: 'USD',
      paymentReferenceText: 'PILOT-TX-PAYMENT',
    },
  });
  const funder = env.fullToken();
  await request(server)
    .post(`/api/transactions/${ctx.txId}/coordination`)
    .set('Authorization', `Bearer ${funder.token}`)
    .send({
      contactMethod: 'manual phone call',
      institutionResponse: 'Deposit booked',
      depositReference: `DEP-DH-${next()}`,
      institutionConfirmed: true,
    })
    .expect(201);
  await go(env, funder.token, ctx.txId, { to: 'FUNDED_CONFIRMED' });
  await go(env, token, ctx.txId, { to: 'IN_FULFILMENT', shippingConfirmed: true });
  await request(server)
    .post(`/api/transactions/${ctx.txId}/delivery-events`)
    .set('Authorization', `Bearer ${token}`)
    .send({ eventType: 'SELLER_ARRIVED_AT_DELIVERY_POINT' })
    .expect(201);
  await go(env, token, ctx.txId, { to: 'DELIVERED' });
  return ctx;
}

describe('disputes + Sold-as-Seen over HTTP (Sprint 3)', () => {
  let env: HttpEnv;

  beforeAll(async () => {
    env = await createHttpEnv();
  });

  afterAll(async () => {
    await env.close();
  });

  it('an open dispute freezes closure and settlement', async () => {
    const { token } = env.fullToken();
    const ctx = await toDelivered(env, token);
    await go(env, token, ctx.txId, {
      to: 'DISPUTED',
      disputeReason: 'Product condition disputed',
      disputeEvidenceFileIds: ['evidence-1'],
    });
    expect(await stateOf(env, token, ctx.txId)).toBe('DISPUTED');
    // Closure / settlement attempts while DISPUTED are rejected.
    const frozen = await go(env, token, ctx.txId, { to: 'COMPLETED' }, 422);
    expect(frozen.body.code).toBe('FORBIDDEN_TRANSITION');
    const frozenSettle = await go(env, token, ctx.txId, { to: 'SETTLED' }, 422);
    expect(frozenSettle.body.code).toBe('FORBIDDEN_TRANSITION');
    expect(await stateOf(env, token, ctx.txId)).toBe('DISPUTED');
  });

  it('human resolution to refund completes the refund path (with an institution reference)', async () => {
    const { token } = env.fullToken();
    const ctx = await toDelivered(env, token);
    await go(env, token, ctx.txId, {
      to: 'DISPUTED',
      disputeReason: 'Product condition disputed',
      disputeEvidenceFileIds: ['evidence-1'],
    });
    expect(await stateOf(env, token, ctx.txId)).toBe('DISPUTED');
    // Human resolution only: REFUND outcome, then refund execution
    // with an institution settlement/refund reference.
    const resolver = env.fullToken();
    await request(env.app.getHttpServer())
      .post(`/api/transactions/${ctx.txId}/dispute-resolution`)
      .set('Authorization', `Bearer ${resolver.token}`)
      .send({ outcome: 'REFUND', resolution: 'Refund agreed by human resolution' })
      .expect(201);
    await go(env, resolver.token, ctx.txId, { to: 'REFUND_PENDING' });
    // Refund without a reference is rejected.
    const noRef = await go(env, resolver.token, ctx.txId, { to: 'REFUNDED' }, 422);
    expect(noRef.body.code).toBe('GUARD_FAILED');
    await go(env, resolver.token, ctx.txId, {
      to: 'REFUNDED',
      refundConfirmation: {
        settlementReference: `REF-DH-${next()}`,
        executedAmount: 1200,
        currency: 'USD',
        beneficiary: 'Buyer Name',
        receivingMethod: 'bank transfer',
        executionDate: '2026-11-02',
        confirmationDocument: 'refund-confirmation-doc-1',
      },
    });
    await go(env, token, ctx.txId, { to: 'COMPLETED' });
    expect(await stateOf(env, token, ctx.txId)).toBe('COMPLETED');
  });

  it('Sold-as-Seen: product-absent exception keeps DELIVERED and blocks accept/reject until resolved + real handover', async () => {
    const { token } = env.fullToken();
    const ctx = await toDelivered(env, token);
    const server = env.app.getHttpServer();
    // Buyer arrives, product is NOT there: operational exception.
    await request(server)
      .post(`/api/transactions/${ctx.txId}/delivery-events`)
      .set('Authorization', `Bearer ${token}`)
      .send({ eventType: 'BUYER_ARRIVED_AT_HANDOVER' })
      .expect(201);
    await request(server)
      .post(`/api/transactions/${ctx.txId}/delivery-events`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        eventType: 'OPERATIONAL_EXCEPTION_PRODUCT_ABSENT',
        note: 'Buyer arrived, product was not at the point',
      })
      .expect(201);
    await request(server)
      .post(`/api/transactions/${ctx.txId}/delivery-events`)
      .set('Authorization', `Bearer ${token}`)
      .send({ eventType: 'HANDOVER_INSPECTION_COMPLETED' })
      .expect(201);
    await request(server)
      .post(`/api/transactions/${ctx.txId}/handover-acceptance`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        whatsappMessageId: `waba-dh-accept-${next()}`,
        buyerUserId: ctx.buyerId,
      })
      .expect(201);
    // Acceptance is blocked while the exception is unresolved.
    const blocked = await go(env, token, ctx.txId, { to: 'RECEIPT_CONFIRMED' }, 422);
    expect(blocked.body.code).toBe('GUARD_FAILED');
    expect(await stateOf(env, token, ctx.txId)).toBe('DELIVERED');
    // Staff resolves the exception; a real handover then accepts.
    await request(server)
      .post(`/api/transactions/${ctx.txId}/operational-exception/resolve`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(201);
    await go(env, token, ctx.txId, { to: 'RECEIPT_CONFIRMED' });
    expect(await stateOf(env, token, ctx.txId)).toBe('RECEIPT_CONFIRMED');
  });

  it('amendment after shipping is rejected over HTTP (path is dispute)', async () => {
    const { token } = env.fullToken();
    const ctx = await toDelivered(env, token);
    const rejected = await request(env.app.getHttpServer())
      .post(`/api/transactions/${ctx.txId}/amendment`)
      .set('Authorization', `Bearer ${token}`)
      .send({ newContent: 'amended terms after shipping' })
      .expect(422);
    expect(rejected.body.code).toBe('AMENDMENT_FORBIDDEN');
  });
});
