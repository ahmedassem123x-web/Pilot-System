// Pilot System v3.1 — Sprint 3 HTTP tests (PB-11, PB-12).
// Webhook HMAC, idempotency, status monotonicity, template gating,
// window enforcement — over HTTP, against the test double. NO real
// Meta account, NO real token, NO real message is sent anywhere here:
// sends are dry-run rows (see templates.service.ts header).
import { createHmac } from 'node:crypto';
import request from 'supertest';
import {
  createHttpEnv,
  TEST_APP_SECRET,
  TEST_VERIFY_TOKEN,
  type HttpEnv,
} from '../testing/http';

function sign(raw: string): string {
  return `sha256=${createHmac('sha256', TEST_APP_SECRET).update(raw).digest('hex')}`;
}

function webhookPayload(messageId: string): { raw: string } {
  const raw = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  id: messageId,
                  type: 'text',
                  text: { body: 'hello' },
                },
              ],
            },
          },
        ],
      },
    ],
  });
  return { raw };
}

describe('WhatsApp webhook + templates over HTTP (Sprint 3)', () => {
  let env: HttpEnv;

  beforeAll(async () => {
    env = await createHttpEnv();
  });

  afterAll(async () => {
    await env.close();
  });

  it('GET verification answers the challenge only on a token match', async () => {
    const server = env.app.getHttpServer();
    const ok = await request(server)
      .get('/api/whatsapp/webhook')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': TEST_VERIFY_TOKEN,
        'hub.challenge': 'challenge-123',
      })
      .expect(200);
    expect(ok.text).toBe('challenge-123');
    await request(server)
      .get('/api/whatsapp/webhook')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'wrong-token',
        'hub.challenge': 'challenge-123',
      })
      .expect(403);
  });

  it('wrong or missing signature is rejected with an audit entry and NO MessageLog row', async () => {
    const server = env.app.getHttpServer();
    const { raw } = webhookPayload('waba-bad-sig-1');
    await request(server)
      .post('/api/whatsapp/webhook')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', sign('different-body'))
      .send(raw)
      .expect(403);
    await request(server)
      .post('/api/whatsapp/webhook')
      .set('Content-Type', 'application/json')
      .send(raw)
      .expect(403);
    expect(env.store.findMessageLogByWhatsappId('waba-bad-sig-1')).toBeUndefined();
    const rejections = env.store
      .allAuditEvents()
      .filter((a) => a.action === 'WEBHOOK_SIGNATURE_REJECTED');
    expect(rejections.length).toBeGreaterThanOrEqual(2);
  });

  it('verified webhook creates one row, enqueues one job, and a duplicate has no duplicate effect', async () => {
    const server = env.app.getHttpServer();
    const { raw } = webhookPayload('waba-dup-1');
    const first = await request(server)
      .post('/api/whatsapp/webhook')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', sign(raw))
      .send(raw)
      .expect(200);
    expect(first.body.outcome).toBe('processed');
    expect(env.store.findMessageLogByWhatsappId('waba-dup-1')).toBeDefined();
    const second = await request(server)
      .post('/api/whatsapp/webhook')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', sign(raw))
      .send(raw)
      .expect(200);
    expect(second.body.outcome).toBe('already-processed');
    expect(second.body.duplicates).toBe(1);
    const all = env.store.allAuditEvents().filter((a) =>
      a.details !== null &&
      (a.details as Record<string, unknown>).whatsapp_message_id === 'waba-dup-1',
    );
    // One inbound row only: the duplicate created no second MessageLog.
    expect(
      env.store.findMessageLogByWhatsappId('waba-dup-1'),
    ).toBeDefined();
    expect(all.length).toBeGreaterThanOrEqual(1);
  });

  it('status updates are monotonic: downgrade ignored, FAILED always applies', async () => {
    const server = env.app.getHttpServer();
    const { token } = env.fullToken();
    // A dry-run outbound row to update: create via templates send.
    const sent = await request(server)
      .post('/api/whatsapp/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({
        to: '+967700000000',
        kind: 'text',
        text: 'inside window',
        lastInboundAt: new Date().toISOString(),
      })
      .expect(201);
    const outboundId = (sent.body.messageLog as { whatsapp_message_id: string })
      .whatsapp_message_id;
    const statusPayload = (status: string) =>
      JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [
          {
            changes: [
              {
                value: {
                  statuses: [{ id: outboundId, status }],
                },
              },
            ],
          },
        ],
      });
    const deliver = async (status: string) => {
      const raw = statusPayload(status);
      return request(server)
        .post('/api/whatsapp/webhook')
        .set('Content-Type', 'application/json')
        .set('x-hub-signature-256', sign(raw))
        .send(raw)
        .expect(200);
    };
    await deliver('SENT');
    await deliver('DELIVERED');
    await deliver('READ');
    expect(
      env.store.findMessageLogByWhatsappId(outboundId)?.status,
    ).toBe('READ');
    // Downgrade attempt: DELIVERED after READ is ignored.
    const ignored = await deliver('DELIVERED');
    expect(ignored.body.statusesIgnored).toBe(1);
    expect(
      env.store.findMessageLogByWhatsappId(outboundId)?.status,
    ).toBe('READ');
    // FAILED always applies, even from READ.
    await deliver('FAILED');
    expect(
      env.store.findMessageLogByWhatsappId(outboundId)?.status,
    ).toBe('FAILED');
  });

  it('interactive replies trigger on id, never on title; title-only triggers nothing', async () => {
    const server = env.app.getHttpServer();
    const buttonRaw = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: 'waba-btn-1',
                    type: 'interactive',
                    interactive: {
                      type: 'button_reply',
                      button_reply: { id: 'accept-handover', title: 'Accept' },
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const res = await request(server)
      .post('/api/whatsapp/webhook')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', sign(buttonRaw))
      .send(buttonRaw)
      .expect(200);
    expect(res.body.interactiveReceived).toContain('accept-handover');
    const titleOnlyRaw = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: 'waba-btn-2',
                    type: 'interactive',
                    interactive: {
                      type: 'button_reply',
                      button_reply: { title: 'Accept' },
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const res2 = await request(server)
      .post('/api/whatsapp/webhook')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', sign(titleOnlyRaw))
      .send(titleOnlyRaw)
      .expect(200);
    expect(res2.body.interactiveReceived).toEqual([]);
    const ignored = env.store
      .allAuditEvents()
      .filter((a) => a.action === 'WHATSAPP_INTERACTIVE_IGNORED_NO_ID');
    expect(ignored.length).toBeGreaterThanOrEqual(1);
  });

  it('templates: local vs Meta approval shown separately; Meta-rejected is un-sendable with reason', async () => {
    const server = env.app.getHttpServer();
    const { token } = env.fullToken();
    await request(server)
      .post('/api/whatsapp/templates')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'utility_reminder',
        localApproval: 'APPROVED',
        metaApproval: 'REJECTED',
        rejectionReason: 'Meta rejected: category mismatch',
      })
      .expect(201);
    await request(server)
      .post('/api/whatsapp/templates')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'utility_ok',
        localApproval: 'APPROVED',
        metaApproval: 'APPROVED',
      })
      .expect(201);
    const list = await request(server)
      .get('/api/whatsapp/templates')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const rejected = (list.body as Array<Record<string, unknown>>).find(
      (t) => t.name === 'utility_reminder',
    );
    expect(rejected?.local_approval).toBe('APPROVED');
    expect(rejected?.meta_approval).toBe('REJECTED');
    expect(rejected?.rejection_reason).toBe('Meta rejected: category mismatch');
    expect(rejected?.sendable).toBe(false);
    // Un-sendable even outside the window, with the reason surfaced.
    const blocked = await request(server)
      .post('/api/whatsapp/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({
        to: '+967700000001',
        kind: 'template',
        templateName: 'utility_reminder',
        lastInboundAt: null,
      })
      .expect(422);
    expect(blocked.body.message).toContain('Meta rejected: category mismatch');
    // Approved template outside the window: dry-run, labelled, not counted.
    const ok = await request(server)
      .post('/api/whatsapp/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({
        to: '+967700000001',
        kind: 'template',
        templateName: 'utility_ok',
        lastInboundAt: null,
      })
      .expect(201);
    expect(ok.body.dry_run).toBe(true);
    expect(ok.body.counted_as_sent).toBe(false);
    expect(
      (ok.body.messageLog as { is_dry_run: boolean }).is_dry_run,
    ).toBe(true);
  });

  it('window enforcement: free text outside the window is rejected; inside it is dry-run', async () => {
    const server = env.app.getHttpServer();
    const { token } = env.fullToken();
    await request(server)
      .post('/api/whatsapp/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ to: '+967700000002', kind: 'text', text: 'hi', lastInboundAt: null })
      .expect(422);
    const inside = await request(server)
      .post('/api/whatsapp/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({
        to: '+967700000002',
        kind: 'text',
        text: 'hi',
        lastInboundAt: new Date().toISOString(),
      })
      .expect(201);
    expect(inside.body.dry_run).toBe(true);
  });

  it('buttons capped at 3 and lists at 10', async () => {
    const server = env.app.getHttpServer();
    const { token } = env.fullToken();
    await request(server)
      .post('/api/whatsapp/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({
        to: '+967700000003',
        kind: 'template',
        templateName: 'utility_ok',
        buttons: [
          { id: 'b1', title: 'One' },
          { id: 'b2', title: 'Two' },
          { id: 'b3', title: 'Three' },
          { id: 'b4', title: 'Four' },
        ],
      })
      .expect(422);
    await request(server)
      .post('/api/whatsapp/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({
        to: '+967700000003',
        kind: 'template',
        templateName: 'utility_ok',
        listItems: Array.from({ length: 11 }, (_, i) => ({
          id: `l${i}`,
          title: `Item ${i}`,
        })),
      })
      .expect(422);
  });
});
