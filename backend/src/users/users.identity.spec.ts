// PB-06 identity tests. Uses the IN-MEMORY TEST DOUBLE only
// (see in-memory.store.ts header) — not a live database result.
import { DomainError } from '../common/errors';
import {
  createTestEnv,
  draftTx,
  txInput,
} from '../testing/builders';

describe('PB-06 users / identity', () => {
  it('creates one permanent user with one whatsapp_number and a status', () => {
    const env = createTestEnv();
    const user = env.users.createPerson('+967771111111', 'APPROVED');
    expect(user.id).toBeTruthy();
    expect(user.whatsapp_number).toBe('+967771111111');
    expect(user.status).toBe('APPROVED');
    expect(env.users.findByWhatsapp('+967771111111')?.id).toBe(user.id);
  });

  it('rejects a second user with the same whatsapp_number', () => {
    const env = createTestEnv();
    env.users.createPerson('+967772222222');
    expect(() => env.users.createPerson('+967772222222')).toThrow(DomainError);
    try {
      env.users.createPerson('+967772222222');
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as DomainError).code).toBe('DUPLICATE_WHATSAPP_NUMBER');
    }
  });

  it('same person as buyer in one transaction and seller in another creates NO second User row', () => {
    const env = createTestEnv();
    const person = env.users.createPerson('+967773333333');
    const otherA = env.users.createPerson('+967774444444');
    const otherB = env.users.createPerson('+967775555555');
    const txA = env.txs.createTransactionWithParties(
      txInput(),
      person.id,
      otherA.id,
    );
    const txB = env.txs.createTransactionWithParties(
      txInput(),
      otherB.id,
      person.id,
    );
    const partiesA = env.store.partiesForTransaction(txA.id);
    const partiesB = env.store.partiesForTransaction(txB.id);
    expect(partiesA.find((p) => p.role === 'BUYER')?.user_id).toBe(person.id);
    expect(partiesB.find((p) => p.role === 'SELLER')?.user_id).toBe(person.id);
    expect(env.store.countUsers()).toBe(3);
  });

  it('Buyer/Seller lives ONLY in TransactionParty: User rows carry no role', () => {
    const env = createTestEnv();
    const ctx = draftTx(env);
    const user = env.users.findById(ctx.buyer.id);
    expect(user).not.toHaveProperty('role');
    expect(user).not.toHaveProperty('party_role');
  });

  it('rejects the same person as both buyer and seller of ONE transaction', () => {
    const env = createTestEnv();
    const person = env.users.createPerson('+967776666666');
    expect(() =>
      env.txs.createTransactionWithParties(txInput(), person.id, person.id),
    ).toThrow(DomainError);
  });

  it('rejects a second BUYER (or second SELLER) party on one transaction', () => {
    const env = createTestEnv();
    const ctx = draftTx(env);
    const extra = env.users.createPerson('+967777777777');
    expect(() =>
      env.store.addParty(ctx.tx.id, extra.id, 'BUYER'),
    ).toThrow(DomainError);
    expect(() =>
      env.store.addParty(ctx.tx.id, extra.id, 'SELLER'),
    ).toThrow(DomainError);
  });

  it('approve / suspend / mark-not-approved change status', () => {
    const env = createTestEnv();
    const user = env.users.createPerson('+967778888888');
    expect(env.users.approve(user.id).status).toBe('APPROVED');
    expect(env.users.suspend(user.id).status).toBe('SUSPENDED');
    expect(env.users.markNotApproved(user.id).status).toBe('NOT_APPROVED');
  });
});
