// Pilot System v3.1 — Sprint 3 negative tests (CORE PROMPT §1.1, §13.2).
// Proves the forbidden actions have NO endpoint: plausible forbidden
// paths answer 404 even with a full-permission token, and the Sprint 3
// controller sources contain no such route. Also proves the webhook
// and queue modules cannot bypass the transaction Guards: neither
// imports the transaction service nor calls a transition.
import * as fs from 'node:fs';
import * as path from 'node:path';
import request from 'supertest';
import { createHttpEnv, type HttpEnv } from '../testing/http';

const FORBIDDEN_PATHS = [
  '/api/transactions/x/move-money',
  '/api/transactions/x/execute-settlement',
  '/api/transactions/x/execute-refund',
  '/api/transactions/x/confirm-funding-without-confirmation',
  '/api/transactions/x/override-institution',
  '/api/transactions/x/close-on-behalf',
  '/api/transactions/x/amend-after-shipping',
  '/api/transactions/x/change-beneficiary-from-whatsapp',
  '/api/wallets',
  '/api/ledger',
  '/api/admin/create-wallet',
];

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      collectSourceFiles(full, out);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('forbidden endpoints do not exist (Sprint 3)', () => {
  let env: HttpEnv;

  beforeAll(async () => {
    env = await createHttpEnv();
  });

  afterAll(async () => {
    await env.close();
  });

  it('every plausible forbidden path answers 404, even with full permissions', async () => {
    const server = env.app.getHttpServer();
    const { token } = env.fullToken();
    for (const forbidden of FORBIDDEN_PATHS) {
      await request(server)
        .post(forbidden)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(404);
    }
  });

  it('no Sprint 3 controller defines a forbidden route slug', async () => {
    const srcDir = path.join(__dirname, '..');
    const controllers = collectSourceFiles(srcDir).filter((f) =>
      f.endsWith('.controller.ts'),
    );
    expect(controllers.length).toBeGreaterThan(0);
    const forbiddenSlugs = [
      'move-money',
      'execute-settlement',
      'execute-refund',
      'override-institution',
      'close-on-behalf',
      'amend-after-shipping',
      'create-wallet',
    ];
    const hits: string[] = [];
    for (const file of controllers) {
      const content = fs.readFileSync(file, 'utf8');
      for (const slug of forbiddenSlugs) {
        if (content.includes(slug)) {
          hits.push(`${path.relative(srcDir, file)}: ${slug}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it('webhook and queue modules never import the transaction service or call a transition', () => {
    const srcDir = path.join(__dirname, '..');
    const guarded = [
      path.join(srcDir, 'whatsapp', 'whatsapp.service.ts'),
      path.join(srcDir, 'whatsapp', 'templates.service.ts'),
      path.join(srcDir, 'queue', 'queue.service.ts'),
    ];
    for (const file of guarded) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content).not.toContain('TransactionsService');
      expect(content).not.toContain('transactions.service');
      expect(content).not.toMatch(/\.transition\s*\(/);
    }
  });
});
