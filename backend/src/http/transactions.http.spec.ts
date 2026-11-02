// Pilot System v3.1 — Sprint 3 HTTP tests (PB-15 to PB-21, PB-23).
// Runs the REAL Nest application over the IN-MEMORY TEST DOUBLE —
// NOT Prisma, NOT PostgreSQL, NOT a live Meta account. Every HTTP
// assertion here is therefore a transport + Guard-wiring assertion,
// not a live-database or live-Meta result.
import request from 'supertest';
import { createHttpEnv, type HttpEnv } from '../testing/http';

let counter = 0;
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

const voucher = () => ({
  buyerName: 'Buyer Name',
  sellerName: 'Seller Name',
  purpose: 'Purchase of figurine set',
  amount: 1200,
  currency: 'USD',
  paymentReferenceText: 'PILOT-TX-PAYMENT',
});

interface Walked {
  txId: string;
  buyerId: string;
  sellerId: string;
}

async function setupTx(env: HttpEnv, token: string): Promise<Walked> {
  const server = env.app.getHttpServer();
  const buyer = await request(server)
    .post('/api/users')
    .set('Authorization', `Bearer ${token}`)
    .send({ whatsappNumber: `+967700010${String(next()).padStart(3, '0')}` })
    .expect(201);
  const seller = await request(server)
    .post('/api/users')
    .set('Authorization', `Bearer ${token}`)
    .send({ whatsappNumber: `+967700011${String(next()).padStart(3, '0')}` })
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
  return { txId: tx.body.id, buyerId: buyer.body.id, sellerId: seller.body.id };
}

async function transition(
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

async function toAwaiting(env: HttpEnv, token: string): Promise<Walked> {
  const ctx = await setupTx(env, token);
  await transition(env, token, ctx.txId, { to: 'PENDING_REVIEW' });
  await request(env.app.getHttpServer())
    .post(`/api/transactions/${ctx.txId}/party-acceptance`)
    .set('Authorization', `Bearer ${token}`)
    .send({ partyRole: 'BUYER', whatsappMessageId: `waba-acc-b-${next()}` })
    .expect(201);
  await request(env.app.getHttpServer())
    .post(`/api/transactions/${ctx.txId}/party-acceptance`)
    .set('Authorization', `Bearer ${token}`)
    .send({ partyRole: 'SELLER', whatsappMessageId: `waba-acc-s-${next()}` })
    .expect(201);
  await transition(env, token, ctx.txId, { to: 'ACCEPTED' });
  await transition(env, token, ctx.txId, {
    to: 'AWAITING_FUNDING_CONFIRMATION',
    voucher: voucher(),
  });
  return ctx;
}

async function toFunded(
  env: HttpEnv,
  token: string,
  funder: { token: string; staffId: string },
): Promise<Walked & { depositRef: string }> {
  const ctx = await toAwaiting(env, token);
  const depositRef = `DEP-HTTP-${next()}`;
  await request(env.app.getHttpServer())
    .post(`/api/transactions/${ctx.txId}/coordination`)
    .set('Authorization', `Bearer ${funder.token}`)
    .send({
      contactMethod: 'manual phone call',
      institutionResponse: 'Deposit booked',
      depositReference: depositRef,
      institutionConfirmed: true,
    })
    .expect(201);
  await transition(env, funder.token, ctx.txId, { to: 'FUNDED_CONFIRMED' });
  return { ...ctx, depositRef };
}

describe('transactions HTTP (Sprint 3)', () => {
  let env: HttpEnv;

  beforeAll(async () => {
    env = await createHttpEnv();
  });

  afterAll(async () => {
    await env.close();
  });

  it('requires JWT: no token is 401, and a token without the permission is 403', async () => {
    const { token: full } = env.fullToken();
    const ctx = await setupTx(env, full);
    await request(env.app.getHttpServer())
      .get(`/api/transactions/${ctx.txId}`)
      .expect(401);
    await request(env.app.getHttpServer())
      .post(`/api/transactions/${ctx.txId}/transition`)
      .send({ to: 'PENDING_REVIEW' })
      .expect(401);
    const { token: weak } = env.tokenFor(['transactions.create']);
    const denied = await transition(env, weak, ctx.txId, {
      to: 'PENDING_REVIEW',
    }, 403);
    expect(denied.body.code).toBe('PERMISSION_DENIED');
    expect(await stateOf(env, full, ctx.txId)).toBe('DRAFT');
  });

  it('evidence is never funding: evidence alone cannot reach FUNDED_CONFIRMED', async () => {
    const { token } = env.fullToken();
    const ctx = await toAwaiting(env, token);
    const evidence = await request(env.app.getHttpServer())
      .post(`/api/transactions/${ctx.txId}/evidence`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        channel: 'bank transfer',
        senderName: 'Buyer Name',
        beneficiaryNameAsShown: 'Seller Name',
        amount: 1200,
        currency: 'USD',
        externalPaymentReference: `EXT-HTTP-${next()}`,
      })
      .expect(201);
    expect(evidence.body.status).toBe('PAYMENT_EVIDENCE_SUBMITTED');
    const rejected = await transition(env, token, ctx.txId, {
      to: 'FUNDED_CONFIRMED',
    }, 422);
    expect(rejected.body.code).toBe('GUARD_FAILED');
    expect(await stateOf(env, token, ctx.txId)).toBe(
      'AWAITING_FUNDING_CONFIRMATION',
    );
  });

  it('full lifecycle via HTTP: voucher, funding gate, fulfilment, delivery, settlement, completion', async () => {
    const { token } = env.fullToken();
    const funder = env.fullToken();
    const ctx = await toFunded(env, token, funder);
    expect(await stateOf(env, token, ctx.txId)).toBe('FUNDED_CONFIRMED');

    // Voucher read-back: field list + issued voucher from the audit row.
    const voucherRes = await request(env.app.getHttpServer())
      .get(`/api/transactions/${ctx.txId}/voucher`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(voucherRes.body.fields).toContain('buyer_name');
    expect(voucherRes.body.fields).toContain(
      'channel_or_entity_or_receiving_account_data_when_approved',
    );
    expect(
      (voucherRes.body.voucher as { buyerName: string }).buyerName,
    ).toBe('Buyer Name');

    // Four financial references, separate fields, never merged.
    const refs = await request(env.app.getHttpServer())
      .get(`/api/transactions/${ctx.txId}/financial-references`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(refs.body.transaction_id).toBe(ctx.txId);
    expect(refs.body.financial_institution_deposit_reference).toBe(
      ctx.depositRef,
    );
    expect(refs.body.financial_institution_settlement_reference).toBeNull();

    await transition(env, token, ctx.txId, {
      to: 'IN_FULFILMENT',
      shippingConfirmed: true,
    });
    await request(env.app.getHttpServer())
      .post(`/api/transactions/${ctx.txId}/delivery-events`)
      .set('Authorization', `Bearer ${token}`)
      .send({ eventType: 'SELLER_ARRIVED_AT_DELIVERY_POINT', note: 'arrived' })
      .expect(201);
    await transition(env, token, ctx.txId, { to: 'DELIVERED' });
    await request(env.app.getHttpServer())
      .post(`/api/transactions/${ctx.txId}/delivery-events`)
      .set('Authorization', `Bearer ${token}`)
      .send({ eventType: 'BUYER_ARRIVED_AT_HANDOVER' })
      .expect(201);
    await request(env.app.getHttpServer())
      .post(`/api/transactions/${ctx.txId}/delivery-events`)
      .set('Authorization', `Bearer ${token}`)
      .send({ eventType: 'HANDOVER_INSPECTION_COMPLETED' })
      .expect(201);
    await request(env.app.getHttpServer())
      .post(`/api/transactions/${ctx.txId}/handover-acceptance`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        whatsappMessageId: `waba-handover-${next()}`,
        buyerUserId: ctx.buyerId,
      })
      .expect(201);
    await transition(env, token, ctx.txId, { to: 'RECEIPT_CONFIRMED' });

    // Beneficiary changed from a WhatsApp message alone: rejected.
    const badSettlement = await transition(env, token, ctx.txId, {
      to: 'SETTLEMENT_PENDING',
      settlementSummary: {
        deposit_reference: ctx.depositRef,
        amount: 1200,
        currency: 'USD',
        beneficiary_name: 'Someone Else',
        delivery_proof_or_dispute_outcome: 'Delivery proof: handover accepted',
      },
      beneficiaryChangedFromWhatsappMessage: true,
    }, 422);
    expect(badSettlement.body.code).toBe('GUARD_FAILED');

    await transition(env, token, ctx.txId, {
      to: 'SETTLEMENT_PENDING',
      settlementSummary: {
        deposit_reference: ctx.depositRef,
        amount: 1200,
        currency: 'USD',
        beneficiary_name: 'Seller Name',
        delivery_proof_or_dispute_outcome: 'Delivery proof: handover accepted',
      },
    });
    const detail = await request(env.app.getHttpServer())
      .get(`/api/transactions/${ctx.txId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const summaryId = (
      detail.body.settlement_summaries as Array<{ id: string }>
    )[0].id;

    // Separation of duties via HTTP: the funder may NOT settle.
    await request(env.app.getHttpServer())
      .post(`/api/transactions/${ctx.txId}/settlement-confirmation`)
      .set('Authorization', `Bearer ${funder.token}`)
      .send({
        settlementSummaryId: summaryId,
        settlementReference: `SET-HTTP-${next()}`,
        confirmationAt: new Date().toISOString(),
      })
      .expect(201);
    const sod = await transition(env, funder.token, ctx.txId, {
      to: 'SETTLED',
    }, 403);
    expect(sod.body.code).toBe('SEPARATION_OF_DUTIES_VIOLATION');
    const settler = env.fullToken();
    await transition(env, settler.token, ctx.txId, { to: 'SETTLED' });
    await transition(env, token, ctx.txId, { to: 'COMPLETED' });
    expect(await stateOf(env, token, ctx.txId)).toBe('COMPLETED');
  });

  it('audit view is read-only over HTTP and requires audit.view', async () => {
    const { token } = env.fullToken();
    const ctx = await setupTx(env, token);
    const { token: weak } = env.tokenFor(['transactions.create']);
    await request(env.app.getHttpServer())
      .get(`/api/transactions/${ctx.txId}/audit`)
      .set('Authorization', `Bearer ${weak}`)
      .expect(403);
    const audit = await request(env.app.getHttpServer())
      .get(`/api/transactions/${ctx.txId}/audit`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(Array.isArray(audit.body)).toBe(true);
  });
});
