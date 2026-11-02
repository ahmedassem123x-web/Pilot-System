// Pilot System v3.1 — Sprint 4 (PB-26). One negative test for EVERY
// prohibition in CORE PROMPT §1.1. A suite without negative tests is
// INCOMPLETE, so these tests read the actual non-spec source (backend
// + frontend) and the Prisma schema/migration and fail if a forbidden
// construct exists there. Prohibition WORDS in comments are not
// artefacts — comments that say "no wallet" are not a wallet — so
// full-line comments and block comments are stripped before matching.
// Code identifiers, route paths, table names, and job/timer
// constructs are what is matched.
import * as fs from 'node:fs';
import * as path from 'node:path';

function collectCode(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      collectCode(full, out);
    } else if (
      (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
      !entry.name.endsWith('.spec.ts') &&
      !entry.name.endsWith('.test.tsx')
    ) {
      out.push(full);
    }
  }
}

function stripComments(source: string): string {
  const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, '');
  return withoutBlocks
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

function readStripped(files: string[]): string {
  return files.map((f) => stripComments(fs.readFileSync(f, 'utf8'))).join('\n');
}

const backendRoot = path.join(__dirname, '..');
const frontendRoot = path.join(__dirname, '..', '..', '..', 'frontend', 'src');
const backendFiles: string[] = [];
collectCode(backendRoot, backendFiles);
const frontendFiles: string[] = [];
if (fs.existsSync(frontendRoot)) collectCode(frontendRoot, frontendFiles);
const backendCode = readStripped(backendFiles);
const frontendCode = readStripped(frontendFiles);
const allCode = `${backendCode}\n${frontendCode}`;
const backendDir = path.join(__dirname, '..', '..');
const schema = stripComments(
  fs.readFileSync(path.join(backendDir, 'prisma', 'schema.prisma'), 'utf8'),
);
const migration = fs.readFileSync(
  path.join(backendDir, 'prisma', 'migrations', '20261102040000_init', 'migration.sql'),
  'utf8',
);

describe('prohibitions (CORE PROMPT §1.1) — negative tests', () => {
  it('no Control Tower in any name or form: no module, table, role, permission, route, KPI, report, or budget', () => {
    expect(allCode).not.toMatch(/control[ ._-]?tower/i);
    expect(schema).not.toMatch(/control[ ._-]?tower/i);
    expect(schema).not.toMatch(/model\s+ControlTower/i);
  });

  it('no implicit acceptance: no timer, scheduler, cron, or hour-window job in code, triggers, or jobs', () => {
    expect(allCode).not.toMatch(/setTimeout|setInterval|setImmediate/);
    expect(allCode).not.toMatch(/@Cron|node-cron|scheduleJob|bullmq/i);
    // Acceptance-window identifiers only: the 24-hour customer-service
    // window constant (WINDOW_MS, for WhatsApp free text) is a
    // different, legitimate rule and is NOT an acceptance window.
    expect(allCode).not.toMatch(/inspectionWindow|acceptanceWindow|autoAccept|silenceAccept/i);
    expect(migration.toLowerCase()).not.toContain('pg_cron');
    // Migration triggers are immutability-only: they BLOCK writes.
    const triggers = [...migration.matchAll(/CREATE TRIGGER (\w+)/g)].map((m) => m[1]);
    expect(triggers.length).toBeGreaterThan(0);
    for (const name of triggers) {
      expect(name.toLowerCase()).toMatch(/immutable|append/);
    }
  });

  it('no programmatic movement of money: no wallet, ledger, gateway, disbursement, or payout construct', () => {
    expect(allCode).not.toMatch(/\bwallet\b/i);
    expect(allCode).not.toMatch(/\bledger\b/i);
    expect(allCode).not.toMatch(/\bgateway\b/i);
    expect(allCode).not.toMatch(/\bdisburse\w*\b/i);
    expect(allCode).not.toMatch(/\bpayout\w*\b/i);
    expect(allCode).not.toMatch(/stripe|paypal|executeTransfer/i);
    expect(schema).not.toMatch(/model\s+(Wallet|Ledger|PaymentGateway)\b/);
  });

  it('no platform fees, commissions, or distributions computed from amounts', () => {
    expect(allCode).not.toMatch(/\bcommission\b/i);
    expect(allCode).not.toMatch(/platform[ ._-]?fee/i);
    expect(allCode).not.toMatch(/\bfee\s*=/);
    expect(schema).not.toMatch(/fee|commission/i);
  });

  it('no marketplace, catalogue, matching, or customer app/portal surface', () => {
    expect(allCode).not.toMatch(/\bmarketplace\b/i);
    expect(allCode).not.toMatch(/\bcatalog(ue)?\b/i);
    expect(allCode).not.toMatch(/customerPortal|customerApp|CustomerPortal/i);
    // Route prefixes declared in controllers carry no forbidden surface.
    const routes = [...allCode.matchAll(/@Controller\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]);
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      expect(route).not.toMatch(/marketplace|catalog|broadcast|tower|wallet|customer|portal/i);
    }
    expect(schema).not.toMatch(/model\s+(Marketplace|Catalog|Product)\b/);
  });

  it('no WhatsApp Web / QR / unofficial transport and no BSP in the baseline', () => {
    expect(allCode).not.toMatch(/baileys|evolution|waha|whatsapp-web/i);
    expect(allCode).not.toMatch(/BSP|business solution provider/i);
  });

  it('no AI that sells, closes, decides a dispute, or sends without human review', () => {
    expect(allCode).not.toMatch(/openai|anthropic|gpt-4|claude/i);
    expect(allCode).not.toMatch(/aiSell|aiClose|aiDecide|autoDecide/i);
  });

  it('no broadcasts, no store sync, no mass targeting', () => {
    expect(allCode).not.toMatch(/\bbroadcast\b/i);
    expect(allCode).not.toMatch(/storeSync|catalogSync|massTarget/i);
  });

  it('no multi-currency accounting and no multi-institution support', () => {
    expect(allCode).not.toMatch(/exchangeRate|multiCurrency|multiInstitution/i);
    expect(schema).not.toMatch(/model\s+FinancialInstitution\b/);
    expect(schema).not.toMatch(/exchange_rate/);
  });

  it('no demo data auto-seeded into production and no escrow claim about the institution', () => {
    expect(allCode).not.toMatch(/\bseed\s*\(/);
    expect(allCode).not.toMatch(/demoUser|demo-user|demoTx/i);
    expect(allCode).not.toMatch(/escrow account|escrowAccount/i);
  });

  it('no secret values in non-spec source: only environment variable names are read', () => {
    // Reads of process.env.* are name references; an assignment of a
    // literal secret to a *_SECRET / *_TOKEN name would be a defect.
    // The lookbehind keeps labelled test-only fixture constants
    // (TEST_JWT_SECRET in src/testing) from matching: only a bare
    // secret name being assigned a literal counts.
    expect(allCode).not.toMatch(/(?<![A-Za-z0-9_])(JWT_SECRET|WHATSAPP_APP_SECRET|FILE_LINK_SECRET)\s*=\s*['"][^'"]+['"]/);
  });
});
