// Pilot System v3.1 — Sprint 2 test builders.
// TEST-ONLY helpers. Every environment here uses the IN-MEMORY TEST
// DOUBLE (InMemoryStore), clearly labelled in in-memory.store.ts —
// NOT Prisma, NOT PostgreSQL. Nothing built here is a live-database
// result. Sprint 3 replaces the store; these builders keep working
// against the Store interface.
import { InMemoryStore } from '../store/in-memory.store';
import { AuditService } from '../audit/audit.service';
import { UsersService } from '../users/users.service';
import { AuthService } from '../auth/auth.service';
import { RbacService, TRANSACTION_PERMISSIONS } from '../auth/rbac.service';
import {
  TransactionsService,
  Actor,
} from '../transactions/transactions.service';
import type { Transaction, User } from '../store/repository';
import type { TransactionState } from '../common/transaction-state';

export const ALL_PERMISSIONS: string[] = [...TRANSACTION_PERMISSIONS];

export interface TestEnv {
  store: InMemoryStore;
  audit: AuditService;
  users: UsersService;
  auth: AuthService;
  rbac: RbacService;
  txs: TransactionsService;
}

let counter = 0;
function next(): number {
  counter += 1;
  return counter;
}

export function createTestEnv(): TestEnv {
  const store = new InMemoryStore();
  const audit = new AuditService(store);
  const users = new UsersService(store);
  const auth = new AuthService({ jwtSecret: 'test-only-jwt-secret' });
  const rbac = new RbacService(store);
  const txs = new TransactionsService(store, audit);
  return { store, audit, users, auth, rbac, txs };
}

/** Creates a staff user and returns an Actor carrying the permissions. */
export function staffActor(env: TestEnv, permissions: string[]): Actor {
  const n = next();
  const staff = env.rbac.createStaffUser(
    `staff-${n}@test.invalid`,
    'test-only-unverified-hash',
    `Staff ${n}`,
  );
  return { id: staff.id, role: 'STAFF', permissions };
}

export function fullStaffActor(env: TestEnv): Actor {
  return staffActor(env, ALL_PERMISSIONS);
}

export function txInput(): {
  amount: number;
  currency: string;
  product_description: string;
  quantity: number;
  delivery_point: string;
  cancellation_terms: string;
} {
  return {
    amount: 1200,
    currency: 'USD',
    product_description: 'Test figurine set',
    quantity: 2,
    delivery_point: 'Sana\'a pickup point',
    cancellation_terms: 'Cancel before funding with both parties agreement',
  };
}

export interface TxContext {
  tx: Transaction;
  buyer: User;
  seller: User;
  depositRef?: string;
  fundingStaffId?: string;
  settlementSummaryId?: string;
}

export function draftTx(env: TestEnv): TxContext {
  const buyer = env.users.createPerson(`+967700000${String(next()).padStart(3, '0')}`);
  const seller = env.users.createPerson(`+967700001${String(next()).padStart(3, '0')}`);
  const tx = env.txs.createTransactionWithParties(
    txInput(),
    buyer.id,
    seller.id,
  );
  env.txs.createContractVersion(tx.id, 'contract content version 1');
  return { tx, buyer, seller };
}

export function refresh(env: TestEnv, ctx: TxContext): TxContext {
  return { ...ctx, tx: env.txs.getTransaction(ctx.tx.id) };
}

export function toPendingReview(env: TestEnv, ctx: TxContext): TxContext {
  const actor = fullStaffActor(env);
  env.txs.transition(ctx.tx.id, actor, 'PENDING_REVIEW');
  return refresh(env, ctx);
}

export function toAccepted(env: TestEnv, ctx: TxContext): TxContext {
  const pending = toPendingReview(env, ctx);
  const recorder = fullStaffActor(env);
  env.txs.recordPartyAcceptance(
    pending.tx.id,
    'BUYER',
    `waba-accept-buyer-${next()}`,
    recorder.id,
  );
  env.txs.recordPartyAcceptance(
    pending.tx.id,
    'SELLER',
    `waba-accept-seller-${next()}`,
    recorder.id,
  );
  env.txs.transition(pending.tx.id, recorder, 'ACCEPTED');
  return refresh(env, pending);
}

export function voucherInput(): {
  buyerName: string;
  sellerName: string;
  purpose: string;
  amount: number;
  currency: string;
  paymentReferenceText: string;
} {
  return {
    buyerName: 'Buyer Name',
    sellerName: 'Seller Name',
    purpose: 'Purchase of figurine set',
    amount: 1200,
    currency: 'USD',
    paymentReferenceText: 'PILOT-TX-PAYMENT',
  };
}

export function toAwaiting(env: TestEnv, ctx: TxContext): TxContext {
  const accepted = toAccepted(env, ctx);
  const actor = fullStaffActor(env);
  env.txs.transition(accepted.tx.id, actor, 'AWAITING_FUNDING_CONFIRMATION', {
    voucher: voucherInput(),
  });
  return refresh(env, accepted);
}

export function toFunded(env: TestEnv, ctx: TxContext): TxContext {
  const awaiting = toAwaiting(env, ctx);
  const fundingStaff = fullStaffActor(env);
  const depositRef = `DEP-TEST-${next()}`;
  env.txs.recordCoordination({
    transactionId: awaiting.tx.id,
    staffId: fundingStaff.id,
    contactMethod: 'manual phone call',
    institutionResponse: 'Deposit booked',
    depositReference: depositRef,
    institutionConfirmed: true,
  });
  env.txs.transition(awaiting.tx.id, fundingStaff, 'FUNDED_CONFIRMED');
  return {
    ...refresh(env, awaiting),
    depositRef,
    fundingStaffId: fundingStaff.id,
  };
}

export function toInFulfilment(env: TestEnv, ctx: TxContext): TxContext {
  const funded = toFunded(env, ctx);
  const actor = fullStaffActor(env);
  env.txs.transition(funded.tx.id, actor, 'IN_FULFILMENT', {
    shippingConfirmed: true,
  });
  return refresh(env, funded);
}

export function toDelivered(env: TestEnv, ctx: TxContext): TxContext {
  const fulfil = toInFulfilment(env, ctx);
  const actor = fullStaffActor(env);
  env.txs.recordDeliveryEvent(
    fulfil.tx.id,
    'SELLER_ARRIVED_AT_DELIVERY_POINT',
    actor.id,
    'Seller arrived with product',
  );
  env.txs.transition(fulfil.tx.id, actor, 'DELIVERED');
  return refresh(env, fulfil);
}

export function toReceiptConfirmed(env: TestEnv, ctx: TxContext): TxContext {
  const delivered = toDelivered(env, ctx);
  const actor = fullStaffActor(env);
  env.txs.recordDeliveryEvent(
    delivered.tx.id,
    'BUYER_ARRIVED_AT_HANDOVER',
    actor.id,
    'Buyer arrived',
  );
  env.txs.recordDeliveryEvent(
    delivered.tx.id,
    'HANDOVER_INSPECTION_COMPLETED',
    actor.id,
    'Inspection completed',
  );
  env.txs.recordHandoverAcceptance(
    delivered.tx.id,
    `waba-handover-accept-${next()}`,
    delivered.buyer.id,
  );
  env.txs.transition(delivered.tx.id, actor, 'RECEIPT_CONFIRMED');
  return refresh(env, delivered);
}

export function settlementSummaryInput(ctx: TxContext): {
  deposit_reference: string;
  amount: number;
  currency: string;
  beneficiary_name: string;
  delivery_proof_or_dispute_outcome: string;
} {
  return {
    deposit_reference: ctx.depositRef as string,
    amount: 1200,
    currency: 'USD',
    beneficiary_name: 'Seller Name',
    delivery_proof_or_dispute_outcome: 'Delivery proof: handover accepted',
  };
}

export function toSettlementPending(env: TestEnv, ctx: TxContext): TxContext {
  const receipt = toReceiptConfirmed(env, ctx);
  const actor = fullStaffActor(env);
  env.txs.transition(receipt.tx.id, actor, 'SETTLEMENT_PENDING', {
    settlementSummary: settlementSummaryInput(receipt),
  });
  const summaries = env.store.settlementSummariesForTransaction(receipt.tx.id);
  return {
    ...refresh(env, receipt),
    settlementSummaryId: summaries[summaries.length - 1].id,
  };
}

export function toSettled(env: TestEnv, ctx: TxContext): TxContext {
  const pending = toSettlementPending(env, ctx);
  const settler = staffActor(env, ALL_PERMISSIONS);
  // Separation of duties: the settler must differ from the funder.
  // fullStaffActor creates a fresh staff member each time, so the
  // settler here is always different from pending.fundingStaffId.
  env.txs.recordSettlementConfirmation(pending.settlementSummaryId as string, {
    settlementReference: `SET-TEST-${next()}`,
    confirmationAt: new Date(),
    actorId: settler.id,
  });
  env.txs.transition(pending.tx.id, settler, 'SETTLED');
  return refresh(env, pending);
}

export function toDisputed(
  env: TestEnv,
  ctx: TxContext,
  fromState: TransactionState,
): TxContext {
  let walked: TxContext;
  switch (fromState) {
    case 'AWAITING_FUNDING_CONFIRMATION':
      walked = toAwaiting(env, ctx);
      break;
    case 'FUNDED_CONFIRMED':
      walked = toFunded(env, ctx);
      break;
    case 'IN_FULFILMENT':
      walked = toInFulfilment(env, ctx);
      break;
    case 'DELIVERED':
      walked = toDelivered(env, ctx);
      break;
    case 'RECEIPT_CONFIRMED':
      walked = toReceiptConfirmed(env, ctx);
      break;
    case 'SETTLEMENT_PENDING':
      walked = toSettlementPending(env, ctx);
      break;
    default:
      throw new Error(`toDisputed does not support from-state ${fromState}`);
  }
  const actor = fullStaffActor(env);
  env.txs.transition(walked.tx.id, actor, 'DISPUTED', {
    disputeReason: 'Test dispute reason',
    disputeEvidenceFileIds: ['evidence-file-1'],
  });
  return refresh(env, walked);
}

export function toRefundPending(env: TestEnv, ctx: TxContext): TxContext {
  const disputed = toDisputed(env, ctx, 'FUNDED_CONFIRMED');
  const resolver = fullStaffActor(env);
  env.txs.resolveDispute(disputed.tx.id, {
    outcome: 'REFUND',
    resolution: 'Refund agreed by human resolution',
    resolvedBy: resolver.id,
  });
  env.txs.transition(disputed.tx.id, resolver, 'REFUND_PENDING');
  return refresh(env, disputed);
}

export function toRefunded(env: TestEnv, ctx: TxContext): TxContext {
  const refundPending = toRefundPending(env, ctx);
  const recorder = staffActor(env, ALL_PERMISSIONS);
  env.txs.transition(refundPending.tx.id, recorder, 'REFUNDED', {
    refundConfirmation: {
      settlementReference: `REF-TEST-${next()}`,
      executedAmount: 1200,
      currency: 'USD',
      beneficiary: 'Buyer Name',
      receivingMethod: 'bank transfer',
      executionDate: '2026-11-02',
      confirmationDocument: 'refund-confirmation-doc-1',
    },
  });
  return refresh(env, refundPending);
}

export function toCompletedFromSettled(env: TestEnv, ctx: TxContext): TxContext {
  const settled = toSettled(env, ctx);
  const actor = fullStaffActor(env);
  env.txs.transition(settled.tx.id, actor, 'COMPLETED');
  return refresh(env, settled);
}

export function toCompletedFromRefunded(env: TestEnv, ctx: TxContext): TxContext {
  const refunded = toRefunded(env, ctx);
  const actor = fullStaffActor(env);
  env.txs.transition(refunded.tx.id, actor, 'COMPLETED');
  return refresh(env, refunded);
}

export function walkTo(env: TestEnv, ctx: TxContext, state: TransactionState): TxContext {
  switch (state) {
    case 'DRAFT':
      return ctx;
    case 'PENDING_REVIEW':
      return toPendingReview(env, ctx);
    case 'ACCEPTED':
      return toAccepted(env, ctx);
    case 'AWAITING_FUNDING_CONFIRMATION':
      return toAwaiting(env, ctx);
    case 'FUNDED_CONFIRMED':
      return toFunded(env, ctx);
    case 'IN_FULFILMENT':
      return toInFulfilment(env, ctx);
    case 'DELIVERED':
      return toDelivered(env, ctx);
    case 'RECEIPT_CONFIRMED':
      return toReceiptConfirmed(env, ctx);
    case 'SETTLEMENT_PENDING':
      return toSettlementPending(env, ctx);
    case 'SETTLED':
      return toSettled(env, ctx);
    case 'DISPUTED':
      return toDisputed(env, ctx, 'FUNDED_CONFIRMED');
    case 'REFUND_PENDING':
      return toRefundPending(env, ctx);
    case 'REFUNDED':
      return toRefunded(env, ctx);
    case 'COMPLETED':
      return toCompletedFromSettled(env, ctx);
    case 'CANCELLED': {
      const draft = ctx;
      const actor = fullStaffActor(env);
      env.txs.transition(draft.tx.id, actor, 'CANCELLED', {
        cancellationReason: 'Test cancellation',
      });
      return refresh(env, draft);
    }
    default:
      throw new Error(`walkTo does not support ${state}`);
  }
}
