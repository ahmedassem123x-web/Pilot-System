// Pilot System v3.1 — Sprint 3 unit tests (PB-25). Backup snapshot
// round-trip over the in-memory test double. This is NOT a live
// PostgreSQL restore test (see backup.service.ts header + runbook).
import { InMemoryStore } from '../store/in-memory.store';
import { BackupService } from './backup.service';
import { AuditService } from '../audit/audit.service';
import { TransactionsService } from '../transactions/transactions.service';

describe('backup snapshot round-trip (test double)', () => {
  it('exports from one store and restores into a fresh store with states, audit, and evidence intact', () => {
    const source = new InMemoryStore();
    const audit = new AuditService(source);
    const txs = new TransactionsService(source, audit);
    const buyer = source.createUser({ whatsapp_number: '+967700030001' });
    const seller = source.createUser({ whatsapp_number: '+967700030002' });
    const tx = txs.createTransactionWithParties(
      {
        amount: 500,
        currency: 'USD',
        product_description: 'Backup item',
        quantity: 1,
        delivery_point: 'Test point',
        cancellation_terms: 'Test terms',
      },
      buyer.id,
      seller.id,
    );
    txs.createContractVersion(tx.id, 'contract v1');
    txs.submitPaymentEvidence({
      transactionId: tx.id,
      channel: 'bank transfer',
      senderName: 'Buyer Name',
      amount: 500,
      currency: 'USD',
      externalPaymentReference: 'EXT-BACKUP-1',
      submittedBy: buyer.id,
    });
    const backup = new BackupService(source);
    const snapshot = backup.exportSnapshot();
    const validation = backup.validateSnapshot(snapshot);
    expect(validation.valid).toBe(true);
    expect(validation.problems).toEqual([]);

    const target = new InMemoryStore();
    const restored = new BackupService(target).restoreSnapshot(snapshot);
    expect(restored.transactions).toHaveLength(1);
    expect(restored.transactions[0].state).toBe('DRAFT');
    expect(restored.transactions[0].id).toBe(tx.id);
    expect(restored.evidences).toHaveLength(1);
    expect(restored.evidences[0].status).toBe('PAYMENT_EVIDENCE_SUBMITTED');
    expect(restored.auditEvents.length).toBeGreaterThan(0);
    expect(
      target.findTransactionById(tx.id)?.product_description,
    ).toBe('Backup item');
  });

  it('a snapshot with a tampered evidence status fails validation and is never imported', () => {
    const source = new InMemoryStore();
    const backup = new BackupService(source);
    const snapshot = backup.exportSnapshot();
    (snapshot.evidences as Array<{ status: string }>).push({
      status: 'FUNDED',
    } as unknown as (typeof snapshot.evidences)[number]);
    expect(backup.validateSnapshot(snapshot).valid).toBe(false);
    const target = new InMemoryStore();
    expect(() =>
      new BackupService(target).restoreSnapshot(snapshot),
    ).toThrow('failed validation');
    expect(target.exportSnapshot().transactions).toEqual([]);
  });

  it('import into a non-empty store is refused (fresh-store-only)', () => {
    const source = new InMemoryStore();
    source.createTransaction({
      amount: 1,
      currency: 'USD',
      product_description: 'x',
      quantity: 1,
      delivery_point: 'x',
      cancellation_terms: 'x',
    });
    const snapshot = new BackupService(source).exportSnapshot();
    const target = new InMemoryStore();
    target.createTransaction({
      amount: 2,
      currency: 'USD',
      product_description: 'y',
      quantity: 1,
      delivery_point: 'y',
      cancellation_terms: 'y',
    });
    expect(() =>
      new BackupService(target).restoreSnapshot(snapshot),
    ).toThrow('fresh-store-only');
  });
});
