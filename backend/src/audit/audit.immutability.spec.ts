// PB-09 audit log tests: every state change, evidence submission,
// coordination record and rejected attempt writes an AuditEvent;
// modification is refused. Uses the IN-MEMORY TEST DOUBLE only
// (the live migration triggers are Sprint 1 SQL, not run here).
import { DomainError } from '../common/errors';
import {
  createTestEnv,
  draftTx,
  fullStaffActor,
  toAwaiting,
  toFunded,
} from '../testing/builders';

describe('PB-09 audit log (append-only)', () => {
  it('every state change writes exactly one AuditEvent with actor, roles, states, correlation id, timestamp', () => {
    const env = createTestEnv();
    const ctx = draftTx(env);
    const before = env.store.auditForTransaction(ctx.tx.id).length;
    const actor = fullStaffActor(env);
    env.txs.transition(ctx.tx.id, actor, 'PENDING_REVIEW', {
      correlationId: 'corr-state-change-1',
    });
    const events = env.store.auditForTransaction(ctx.tx.id);
    expect(events.length).toBe(before + 1);
    const last = events[events.length - 1];
    expect(last.action).toBe('TRANSACTION_SUBMITTED_FOR_REVIEW');
    expect(last.actor_id).toBe(actor.id);
    expect(last.actor_role).toBe('STAFF');
    expect(last.previous_state).toBe('DRAFT');
    expect(last.new_state).toBe('PENDING_REVIEW');
    expect(last.correlation_id).toBe('corr-state-change-1');
    expect(last.timestamp).toBeInstanceOf(Date);
  });

  it('evidence submission and coordination records each write an AuditEvent', () => {
    const env = createTestEnv();
    const awaiting = toAwaiting(env, draftTx(env));
    env.txs.submitPaymentEvidence({
      transactionId: awaiting.tx.id,
      channel: 'bank transfer',
      senderName: 'Buyer Name',
      amount: 1200,
      currency: 'USD',
      externalPaymentReference: 'EXT-AUD-1',
      submittedBy: awaiting.buyer.id,
    });
    const staff = fullStaffActor(env);
    env.txs.recordCoordination({
      transactionId: awaiting.tx.id,
      staffId: staff.id,
      contactMethod: 'manual',
      depositReference: 'DEP-AUD-1',
      institutionConfirmed: true,
    });
    const actions = env.store
      .auditForTransaction(awaiting.tx.id)
      .map((a) => a.action);
    expect(actions).toContain('PAYMENT_EVIDENCE_SUBMITTED');
    expect(actions).toContain('COORDINATION_RECORDED');
  });

  it('rejected attempts write a TRANSITION_REJECTED AuditEvent', () => {
    const env = createTestEnv();
    const ctx = draftTx(env);
    const actor = fullStaffActor(env);
    expect(() =>
      env.txs.transition(ctx.tx.id, actor, 'COMPLETED'),
    ).toThrow(DomainError);
    const rejections = env.store
      .auditForTransaction(ctx.tx.id)
      .filter((a) => a.action === 'TRANSITION_REJECTED');
    expect(rejections).toHaveLength(1);
    expect(rejections[0].previous_state).toBe('DRAFT');
    expect(rejections[0].new_state).toBe('COMPLETED');
    expect(rejections[0].details).toMatchObject({
      code: 'FORBIDDEN_TRANSITION',
    });
  });

  it('audit update and delete attempts are refused and the row survives', () => {
    const env = createTestEnv();
    const ctx = draftTx(env);
    const actor = fullStaffActor(env);
    env.txs.transition(ctx.tx.id, actor, 'PENDING_REVIEW');
    const event = env.store.auditForTransaction(ctx.tx.id)[0];
    expect(() =>
      env.audit.attemptUpdate(event.id, { action: 'TAMPERED' }),
    ).toThrow(DomainError);
    try {
      env.audit.attemptUpdate(event.id, { action: 'TAMPERED' });
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as DomainError).code).toBe('IMMUTABLE_ROW');
    }
    expect(() => env.audit.attemptDelete(event.id)).toThrow(DomainError);
    const surviving = env.store
      .auditForTransaction(ctx.tx.id)
      .find((a) => a.id === event.id);
    expect(surviving?.action).not.toBe('TAMPERED');
    expect(surviving).toBeTruthy();
  });

  it('audit trail covers a full funded cycle in order', () => {
    const env = createTestEnv();
    const funded = toFunded(env, draftTx(env));
    const actions = env.store
      .auditForTransaction(funded.tx.id)
      .map((a) => a.action);
    expect(actions).toContain('TRANSACTION_SUBMITTED_FOR_REVIEW');
    expect(actions).toContain('CONTRACT_ACCEPTED');
    expect(actions).toContain('FUNDING_AWAITING_STARTED');
    expect(actions).toContain('COORDINATION_RECORDED');
    expect(actions).toContain('FUNDING_CONFIRMED');
  });
});
