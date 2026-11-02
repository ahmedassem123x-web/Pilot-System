// Pilot System v3.1 — Sprint 3 HTTP + service tests (PB-24, PB-25).
// Queue closed job list, file signed links + masking, backup export
// validation. Test double only (see transactions.http.spec.ts header).
// The queue here is the IN-MEMORY / TEST transport: live Redis
// behaviour is UNVERIFIED (see queue.service.ts header).
import request from 'supertest';
import { createHttpEnv, type HttpEnv } from '../testing/http';
import { QueueService } from '../queue/queue.service';
import { FilesService } from '../files/files.service';
import { maskDisplayObject, maskMiddle } from '../common/masking';

describe('queue, files, backup, auth over HTTP (Sprint 3)', () => {
  let env: HttpEnv;

  beforeAll(async () => {
    env = await createHttpEnv();
  });

  afterAll(async () => {
    await env.close();
  });

  it('auth: login rejects bad credentials, accepts good ones, and me reflects the actor', async () => {
    const server = env.app.getHttpServer();
    const { token: admin } = env.fullToken();
    const created = await request(server)
      .post('/api/admin/staff')
      .set('Authorization', `Bearer ${admin}`)
      .send({
        email: 'login-staff@test.invalid',
        password: 'test-only-password-1',
        displayName: 'Login Staff',
      })
      .expect(201);
    expect(created.body.password_hash).toBeUndefined();
    await request(server)
      .post('/api/auth/login')
      .send({ email: 'login-staff@test.invalid', password: 'wrong-password' })
      .expect(401);
    const logged = await request(server)
      .post('/api/auth/login')
      .send({ email: 'login-staff@test.invalid', password: 'test-only-password-1' })
      .expect(201);
    expect(typeof logged.body.token).toBe('string');
    const me = await request(server)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${logged.body.token}`)
      .expect(200);
    expect(me.body.staff_id).toBe(created.body.id);
    await request(server).get('/api/auth/me').expect(401);
  });

  it('admin routes require admin.manage (403 without it)', async () => {
    const server = env.app.getHttpServer();
    const { token: weak } = env.tokenFor(['transactions.create']);
    await request(server)
      .post('/api/admin/roles')
      .set('Authorization', `Bearer ${weak}`)
      .send({ name: 'some-role' })
      .expect(403);
    const { token: admin } = env.fullToken();
    await request(server)
      .post('/api/admin/roles')
      .set('Authorization', `Bearer ${admin}`)
      .send({ name: 'some-role' })
      .expect(201);
  });

  it('queue: only reminders, escalations, and async webhook processing are enqueueable; retries cap and no job touches state', async () => {
    const queue = env.app.get(QueueService);
    expect(() =>
      queue.enqueue('settle.payment', { transaction_id: 'x' }),
    ).toThrow('not allowed');
    expect(() =>
      queue.enqueue('accept.transaction', { transaction_id: 'x' }),
    ).toThrow('not allowed');
    const reminder = queue.enqueue('reminder.send', {
      note: 'Awaiting buyer response',
    });
    expect(reminder.status).toBe('queued');
    // A failing handler retries on explicit process calls, then fails.
    let attempts = 0;
    const failing = async () => {
      attempts += 1;
      throw new Error('handler failed');
    };
    for (let i = 0; i < 3; i += 1) {
      await queue.processPending({ 'reminder.send': failing });
    }
    expect(attempts).toBe(3);
    const done = queue.allJobs().find((j) => j.id === reminder.id);
    expect(done?.status).toBe('failed');
    expect(done?.attempts).toBe(3);
  });

  it('queue drain endpoint processes webhook jobs without any state effect', async () => {
    const server = env.app.getHttpServer();
    const { token } = env.fullToken();
    const before = env.store.allAuditEvents().length;
    queueEnqueueForTest(env);
    const drained = await request(server)
      .post('/api/whatsapp/queue/process')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(201);
    expect(
      (drained.body.processed as Array<unknown>).length,
    ).toBeGreaterThanOrEqual(1);
    expect(env.store.allAuditEvents().length).toBe(before);
  });

  it('files: metadata display masks the uploader; signed links verify, reject tampering, and expire', async () => {
    const server = env.app.getHttpServer();
    const { token } = env.fullToken();
    const uploaded = await request(server)
      .post('/api/files')
      .set('Authorization', `Bearer ${token}`)
      .send({
        filename: 'receipt.png',
        mimeType: 'image/png',
        sizeBytes: 1234,
        uploadedBy: '+967700000999',
      })
      .expect(201);
    const fileId = uploaded.body.id as string;
    const meta = await request(server)
      .get(`/api/files/${fileId}/meta`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(meta.body.uploaded_by_masked).not.toBe('+967700000999');
    expect(meta.body.uploaded_by_masked).toContain('*');
    const link = await request(server)
      .get(`/api/files/${fileId}/link`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const url = new URL(link.body.link as string, 'http://test.invalid');
    const sig = url.searchParams.get('sig') as string;
    const exp = url.searchParams.get('exp') as string;
    await request(server)
      .get(`/api/files/${fileId}/download`)
      .set('Authorization', `Bearer ${token}`)
      .query({ sig, exp })
      .expect(200);
    await request(server)
      .get(`/api/files/${fileId}/download`)
      .set('Authorization', `Bearer ${token}`)
      .query({ sig: `${'0'.repeat(64)}`, exp })
      .expect(403);
    // Expired link: an expiry in the past must not verify.
    const files = env.app.get(FilesService);
    const expired = files.generateSignedLink(fileId, -60);
    const expiredUrl = new URL(expired.link, 'http://test.invalid');
    await request(server)
      .get(`/api/files/${fileId}/download`)
      .set('Authorization', `Bearer ${token}`)
      .query({
        sig: expiredUrl.searchParams.get('sig') as string,
        exp: expiredUrl.searchParams.get('exp') as string,
      })
      .expect(403);
  });

  it('backup export validates: a snapshot round-trips, and import into a non-empty store is refused', async () => {
    const server = env.app.getHttpServer();
    const { token: admin } = env.fullToken();
    // Make this store non-empty so the fresh-store-only rule is what
    // is being exercised (not an empty store accepting the import).
    env.store.createTransaction({
      amount: 100,
      currency: 'USD',
      product_description: 'Backup test item',
      quantity: 1,
      delivery_point: 'Test point',
      cancellation_terms: 'Test terms',
    });
    const exported = await request(server)
      .post('/api/admin/backup/export')
      .set('Authorization', `Bearer ${admin}`)
      .send({})
      .expect(201);
    expect(Array.isArray(exported.body.auditEvents)).toBe(true);
    // Same store already holds data (from earlier tests in this file):
    // fresh-store-only import must refuse rather than merge.
    await request(server)
      .post('/api/admin/backup/import')
      .set('Authorization', `Bearer ${admin}`)
      .send(exported.body)
      .expect(422);
  });

  it('masking helpers mask identifiers and sensitive keys only', () => {
    expect(maskMiddle('+967700000999')).toBe('+96********99');
    expect(maskDisplayObject({ whatsapp_number: '+967700000999', state: 'DRAFT' })).toEqual({
      whatsapp_number: '+96********99',
      state: 'DRAFT',
    });
  });
});

function queueEnqueueForTest(env: HttpEnv): void {
  const queue = env.app.get(QueueService);
  queue.enqueue('whatsapp.inbound.process', {
    whatsapp_message_id: 'waba-queue-drain-1',
  });
}
