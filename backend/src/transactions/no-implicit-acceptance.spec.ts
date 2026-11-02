// No acceptance by time, silence, or automatic step (CORE PROMPT
// §9.1, matrix §5 item 5, critical test 11): this spec FAILS if any
// such code path exists in the Sprint 2 backend source. It greps the
// service source itself (excluding spec files), checks the migration
// triggers, and asserts the only path to RECEIPT_CONFIRMED is the
// explicit Guard in transactions.service.ts.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { findTransitionRow } from './transition-table';
import {
  createTestEnv,
  draftTx,
  toDelivered,
} from '../testing/builders';

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

describe('no acceptance by time, silence, or automatic step', () => {
  it('no timer, scheduler, queue, or hour-window code path exists in backend source', () => {
    const srcDir = path.join(__dirname, '..');
    const files = collectSourceFiles(srcDir);
    expect(files.length).toBeGreaterThan(0);
    const forbidden: Array<{ pattern: RegExp; label: string }> = [
      { pattern: /\bsetTimeout\s*\(/, label: 'setTimeout' },
      { pattern: /\bsetInterval\s*\(/, label: 'setInterval' },
      { pattern: /@Cron\s*\(/, label: 'Cron decorator' },
      { pattern: /bullmq/i, label: 'BullMQ import' },
      { pattern: /\b(24|48|72)\s*-?\s*h(our)?s?\b/i, label: 'hour window' },
    ];
    const hits: string[] = [];
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      for (const { pattern, label } of forbidden) {
        if (pattern.test(content)) {
          hits.push(`${path.relative(srcDir, file)}: ${label}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it('the migration contains only immutability triggers (they block writes; they produce no acceptance)', () => {
    const migration = path.join(
      __dirname,
      '..',
      '..',
      'prisma',
      'migrations',
      '20261102040000_init',
      'migration.sql',
    );
    const sql = fs.readFileSync(migration, 'utf8');
    const triggers = [...sql.matchAll(/CREATE TRIGGER\s+(\w+)/gi)].map(
      (m) => m[1],
    );
    expect(triggers.length).toBeGreaterThan(0);
    for (const name of triggers) {
      expect(name.toLowerCase()).toContain('immutable');
    }
    expect(sql).not.toMatch(/RECEIPT_CONFIRMED.*ACCEPT/i);
  });

  it('the only DELIVERED -> RECEIPT_CONFIRMED path requires the explicit record_receipt permission + Guard', () => {
    const row = findTransitionRow('DELIVERED', 'RECEIPT_CONFIRMED');
    expect(row).toBeTruthy();
    expect(row?.permission).toBe('transactions.record_receipt');
    expect(row?.action).toBe('RECEIPT_CONFIRMED_BY_BUYER');
  });

  it('a DELIVERED transaction stays DELIVERED when nothing explicit happens (no background acceptance)', () => {
    const env = createTestEnv();
    const delivered = toDelivered(env, draftTx(env));
    // No further call of any kind: no acceptance, no message, no job.
    expect(env.txs.getTransaction(delivered.tx.id).state).toBe('DELIVERED');
    const receiptAudit = env.store
      .auditForTransaction(delivered.tx.id)
      .filter((a) => a.action === 'RECEIPT_CONFIRMED_BY_BUYER');
    expect(receiptAudit).toHaveLength(0);
  });
});
