// PB-10 contract amendment policy (CORE PROMPT §10, matrix §5 item 4).
// Uses the IN-MEMORY TEST DOUBLE only.
import { DomainError } from '../common/errors';
import {
  createTestEnv,
  draftTx,
  fullStaffActor,
  toAccepted,
  toDelivered,
  toFunded,
  toInFulfilment,
  toPendingReview,
} from '../testing/builders';

describe('PB-10 contract amendment policy', () => {
  it('before acceptance: new version created, old version preserved, state unchanged', () => {
    const env = createTestEnv();
    const pending = toPendingReview(env, draftTx(env));
    const actor = fullStaffActor(env);
    const before = env.store.versionsForTransaction(pending.tx.id);
    env.txs.requestAmendment(pending.tx.id, actor, {
      newContent: 'contract content version 2 pre-acceptance',
    });
    const after = env.store.versionsForTransaction(pending.tx.id);
    expect(after).toHaveLength(before.length + 1);
    expect(after[0].id).toBe(before[0].id);
    expect(after[0].content_hash).toBe(before[0].content_hash);
    expect(env.store.currentVersion(pending.tx.id)?.version_number).toBe(2);
    expect(env.txs.getTransaction(pending.tx.id).state).toBe('PENDING_REVIEW');
  });

  it('before acceptance in DRAFT: same rule (new version, old preserved)', () => {
    const env = createTestEnv();
    const ctx = draftTx(env);
    const actor = fullStaffActor(env);
    env.txs.requestAmendment(ctx.tx.id, actor, {
      newContent: 'draft amended content',
    });
    expect(env.store.versionsForTransaction(ctx.tx.id)).toHaveLength(2);
    expect(env.txs.getTransaction(ctx.tx.id).state).toBe('DRAFT');
  });

  it('after acceptance before funding/shipping: both approvals + new version + re-acceptance required', () => {
    const env = createTestEnv();
    const accepted = toAccepted(env, draftTx(env));
    const actor = fullStaffActor(env);
    // Without both approvals the amendment transition is rejected.
    expect(() =>
      env.txs.requestAmendment(accepted.tx.id, actor, {
        newContent: 'v2 without approvals',
        buyerApproved: true,
        sellerApproved: false,
      }),
    ).toThrow(DomainError);
    // With both approvals: ACCEPTED -> PENDING_REVIEW + new version.
    env.txs.requestAmendment(accepted.tx.id, actor, {
      newContent: 'contract content version 2 amended',
      buyerApproved: true,
      sellerApproved: true,
    });
    expect(env.txs.getTransaction(accepted.tx.id).state).toBe('PENDING_REVIEW');
    const version = env.store.currentVersion(accepted.tx.id);
    expect(version?.version_number).toBe(2);
    // The new version is NOT accepted until re-accepted via row 3:
    // acceptance requires fresh party acceptances for the new hash.
    expect(() =>
      env.txs.transition(accepted.tx.id, actor, 'ACCEPTED'),
    ).toThrow(DomainError);
    env.txs.recordPartyAcceptance(
      accepted.tx.id,
      'BUYER',
      'waba-reamend-buyer',
      actor.id,
    );
    env.txs.recordPartyAcceptance(
      accepted.tx.id,
      'SELLER',
      'waba-reamend-seller',
      actor.id,
    );
    env.txs.transition(accepted.tx.id, actor, 'ACCEPTED');
    expect(env.txs.getTransaction(accepted.tx.id).state).toBe('ACCEPTED');
    // Old version preserved untouched through the whole cycle.
    const versions = env.store.versionsForTransaction(accepted.tx.id);
    expect(versions).toHaveLength(2);
    expect(versions[0].version_number).toBe(1);
  });

  it('after FUNDED_CONFIRMED: amendment REJECTED + audited', () => {
    const env = createTestEnv();
    const funded = toFunded(env, draftTx(env));
    const actor = fullStaffActor(env);
    let caught: unknown;
    try {
      env.txs.requestAmendment(funded.tx.id, actor, {
        newContent: 'illegal post-funding amendment',
        buyerApproved: true,
        sellerApproved: true,
      });
    } catch (error) {
      caught = error;
    }
    expect((caught as DomainError).code).toBe('AMENDMENT_FORBIDDEN');
    expect(env.txs.getTransaction(funded.tx.id).state).toBe('FUNDED_CONFIRMED');
    expect(env.store.versionsForTransaction(funded.tx.id)).toHaveLength(1);
    const audit = env.store
      .auditForTransaction(funded.tx.id)
      .filter((a) => a.action === 'AMENDMENT_REJECTED');
    expect(audit).toHaveLength(1);
  });

  it('after shipping (IN_FULFILMENT) and after delivery: amendment REJECTED', () => {
    const env = createTestEnv();
    const actor = fullStaffActor(env);
    for (const setup of [toInFulfilment, toDelivered]) {
      const ctx = setup(env, draftTx(env));
      expect(() =>
        env.txs.requestAmendment(ctx.tx.id, actor, {
          newContent: 'illegal amendment',
          buyerApproved: true,
          sellerApproved: true,
        }),
      ).toThrow(DomainError);
      expect(env.store.versionsForTransaction(ctx.tx.id)).toHaveLength(1);
    }
  });
});
