// Pilot System v3.1 — Sprint 4 HTTP tests (PB-13). Inbox read
// endpoints + triage metadata over the real Nest app on the
// IN-MEMORY TEST DOUBLE — not Prisma, not PostgreSQL. These routes
// never bypass a Guard: they read MessageLog rows and hold metadata
// only. Internal notes must never become MessageLog rows.
import request from 'supertest';
import { createHttpEnv, type HttpEnv } from '../testing/http';

describe('inbox read endpoints + triage metadata (PB-13)', () => {
  let env: HttpEnv;
  let token: string;

  beforeAll(async () => {
    env = await createHttpEnv();
    token = env.fullToken().token;
    // Two conversations: one linked to a transaction (with a FAILED
    // message, hence triage attention), one unlinked dry-run row.
    env.store.createMessageLog({
      whatsapp_message_id: 'waba-inbox-1',
      transaction_id: 'tx-inbox-1',
      direction: 'INBOUND',
      status: 'READ',
    });
    env.store.createMessageLog({
      whatsapp_message_id: 'waba-inbox-2',
      transaction_id: 'tx-inbox-1',
      direction: 'OUTBOUND',
      template_name: 'utility_ok',
      status: 'FAILED',
    });
    env.store.createMessageLog({
      whatsapp_message_id: 'waba-inbox-3',
      transaction_id: null,
      direction: 'OUTBOUND',
      status: 'QUEUED',
      is_dry_run: true,
    });
  });

  afterAll(async () => {
    await env.close();
  });

  it('requires staff auth for inbox reads', async () => {
    await request(env.app.getHttpServer())
      .get('/api/whatsapp/inbox')
      .expect(401);
  });

  it('lists messages, filterable by transaction and direction', async () => {
    const all = await request(env.app.getHttpServer())
      .get('/api/whatsapp/messages')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(all.body.length).toBe(3);
    const linked = await request(env.app.getHttpServer())
      .get('/api/whatsapp/messages?transactionId=tx-inbox-1')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(linked.body.length).toBe(2);
    const inbound = await request(env.app.getHttpServer())
      .get('/api/whatsapp/messages?direction=INBOUND')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(inbound.body.length).toBe(1);
  });

  it('groups messages into conversations with computed triage, and filters by triage', async () => {
    const inbox = await request(env.app.getHttpServer())
      .get('/api/whatsapp/inbox')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(inbox.body.length).toBe(2);
    const linked = inbox.body.find(
      (c: { id: string }) => c.id === 'tx-inbox-1',
    );
    expect(linked.messages.length).toBe(2);
    // FAILED message present => attention, before any staff triage.
    expect(linked.triage).toBe('attention');
    const attention = await request(env.app.getHttpServer())
      .get('/api/whatsapp/inbox?triage=attention')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(attention.body.length).toBe(1);
  });

  it('assignment, tags, triage and internal notes are metadata only: no MessageLog row is created', async () => {
    const before = (
      await request(env.app.getHttpServer())
        .get('/api/whatsapp/messages')
        .set('Authorization', `Bearer ${token}`)
    ).body.length;
    await request(env.app.getHttpServer())
      .post('/api/whatsapp/inbox/tx-inbox-1/assign')
      .set('Authorization', `Bearer ${token}`)
      .send({ assignedTo: 'staff-ops-1' })
      .expect(201);
    await request(env.app.getHttpServer())
      .post('/api/whatsapp/inbox/tx-inbox-1/tags')
      .set('Authorization', `Bearer ${token}`)
      .send({ tags: ['funding-question'] })
      .expect(201);
    await request(env.app.getHttpServer())
      .post('/api/whatsapp/inbox/tx-inbox-1/notes')
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'Called buyer, awaiting receipt photo', author: 'staff-ops-1' })
      .expect(201);
    const detail = await request(env.app.getHttpServer())
      .get('/api/whatsapp/inbox/tx-inbox-1')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(detail.body.assignedTo).toBe('staff-ops-1');
    expect(detail.body.tags).toEqual(['funding-question']);
    expect(detail.body.notes).toHaveLength(1);
    expect(detail.body.notes[0].text).toContain('awaiting receipt photo');
    const after = (
      await request(env.app.getHttpServer())
        .get('/api/whatsapp/messages')
        .set('Authorization', `Bearer ${token}`)
    ).body.length;
    // The note was never sent and never became a message row.
    expect(after).toBe(before);
  });

  it('rejects triage metadata for a conversation that does not exist', async () => {
    await request(env.app.getHttpServer())
      .post('/api/whatsapp/inbox/no-such-conversation/assign')
      .set('Authorization', `Bearer ${token}`)
      .send({ assignedTo: 'staff-ops-1' })
      .expect(404);
  });

  it('rejects an invalid triage value', async () => {
    await request(env.app.getHttpServer())
      .post('/api/whatsapp/inbox/tx-inbox-1/triage')
      .set('Authorization', `Bearer ${token}`)
      .send({ triage: 'urgent-now' })
      .expect(422);
  });
});
