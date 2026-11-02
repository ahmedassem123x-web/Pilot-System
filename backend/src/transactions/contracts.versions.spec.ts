// PB-07 contracts / versions tests. Uses the IN-MEMORY TEST DOUBLE
// only (see in-memory.store.ts header) — not a live database result.
import { createHash } from 'node:crypto';
import { DomainError } from '../common/errors';
import { sha256Hex } from './transactions.service';
import {
  createTestEnv,
  draftTx,
  fullStaffActor,
  toAccepted,
  toPendingReview,
} from '../testing/builders';

describe('PB-07 transactions + contracts + versions', () => {
  it('creates a transaction in DRAFT with descriptive fields', () => {
    const env = createTestEnv();
    const ctx = draftTx(env);
    expect(ctx.tx.state).toBe('DRAFT');
    expect(ctx.tx.amount).toBe(1200);
    expect(ctx.tx.currency).toBe('USD');
  });

  it('creates contract version 1 with the SHA-256 hash of its content', () => {
    const env = createTestEnv();
    const ctx = draftTx(env);
    const version = env.store.currentVersion(ctx.tx.id);
    expect(version?.version_number).toBe(1);
    expect(version?.content_hash).toBe(
      createHash('sha256').update('contract content version 1').digest('hex'),
    );
    expect(version?.content_hash).toHaveLength(64);
    expect(sha256Hex('contract content version 1')).toBe(
      version?.content_hash,
    );
  });

  it('new version increments version_number and never overwrites the old row', () => {
    const env = createTestEnv();
    const ctx = draftTx(env);
    const v1 = env.store.currentVersion(ctx.tx.id);
    const v2 = env.txs.createContractVersion(ctx.tx.id, 'contract content version 2');
    expect(v2.version_number).toBe(2);
    const versions = env.store.versionsForTransaction(ctx.tx.id);
    expect(versions).toHaveLength(2);
    expect(versions[0].id).toBe(v1?.id);
    expect(versions[0].content_hash).toBe(v1?.content_hash);
    expect(versions[1].content_hash).not.toBe(v1?.content_hash);
  });

  it('current version = highest version_number, superseded_by ignored for currency', () => {
    const env = createTestEnv();
    const ctx = draftTx(env);
    const v1 = env.store.currentVersion(ctx.tx.id) as { id: string };
    // v2 claims (at insert) that it supersedes v1; v3 carries no pointer.
    env.txs.createContractVersion(ctx.tx.id, 'v2', undefined, v1.id);
    const v3 = env.txs.createContractVersion(ctx.tx.id, 'v3');
    expect(env.store.currentVersion(ctx.tx.id)?.id).toBe(v3.id);
    expect(env.store.currentVersion(ctx.tx.id)?.version_number).toBe(3);
  });

  it('accepted version is frozen: hash + acceptance audit + message logs agree, version row untouched', () => {
    const env = createTestEnv();
    const ctx = toAccepted(env, draftTx(env));
    const version = env.store.currentVersion(ctx.tx.id);
    const acceptedAudit = env.store
      .auditForTransaction(ctx.tx.id)
      .find((a) => a.action === 'CONTRACT_ACCEPTED');
    expect(acceptedAudit).toBeTruthy();
    expect(acceptedAudit?.new_state).toBe('ACCEPTED');
    expect(acceptedAudit?.timestamp).toBeTruthy();
    const acceptances = env.store
      .auditForTransaction(ctx.tx.id)
      .filter((a) => a.action === 'PARTY_ACCEPTANCE');
    expect(acceptances.map((a) => a.actor_role).sort()).toEqual([
      'BUYER',
      'SELLER',
    ]);
    for (const acceptance of acceptances) {
      const messageId = (acceptance.details as Record<string, unknown>)
        .whatsapp_message_id as string;
      const log = env.store.findMessageLogByWhatsappId(messageId);
      expect(log?.transaction_id).toBe(ctx.tx.id);
      expect((acceptance.details as Record<string, unknown>).version_hash).toBe(
        version?.content_hash,
      );
    }
    // The version row itself was NOT mutated by acceptance (immutability).
    expect(version?.accepted_at).toBeNull();
    expect(version?.content_hash).toBe(
      createHash('sha256').update('contract content version 1').digest('hex'),
    );
  });

  it('accepted_by alone never satisfies acceptance: one party only is rejected', () => {
    const env = createTestEnv();
    const pending = toPendingReview(env, draftTx(env));
    const recorder = fullStaffActor(env);
    env.txs.recordPartyAcceptance(
      pending.tx.id,
      'BUYER',
      'waba-only-buyer-acceptance',
      recorder.id,
    );
    expect(() =>
      env.txs.transition(pending.tx.id, recorder, 'ACCEPTED'),
    ).toThrow(DomainError);
    expect(env.txs.getTransaction(pending.tx.id).state).toBe('PENDING_REVIEW');
  });

  it('refuses update and delete of contract version rows', () => {
    const env = createTestEnv();
    const ctx = draftTx(env);
    const version = env.store.currentVersion(ctx.tx.id) as { id: string };
    expect(() =>
      env.store.updateContractVersion(version.id, {
        content_hash: 'tampered',
      }),
    ).toThrow(DomainError);
    try {
      env.store.updateContractVersion(version.id, { content_hash: 'x' });
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as DomainError).code).toBe('IMMUTABLE_ROW');
    }
    expect(() => env.store.deleteContractVersion(version.id)).toThrow(
      DomainError,
    );
    expect(env.store.versionsForTransaction(ctx.tx.id)).toHaveLength(1);
  });

  it('submit requires exactly one buyer and one seller party', () => {
    const env = createTestEnv();
    const tx = env.txs.createTransaction({
      amount: 100,
      currency: 'USD',
      product_description: 'item',
      quantity: 1,
      delivery_point: 'point',
      cancellation_terms: 'terms',
    });
    env.txs.createContractVersion(tx.id, 'content');
    const actor = fullStaffActor(env);
    expect(() =>
      env.txs.transition(tx.id, actor, 'PENDING_REVIEW'),
    ).toThrow(DomainError);
  });
});
