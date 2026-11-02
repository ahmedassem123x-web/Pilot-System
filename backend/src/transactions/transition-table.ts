// Pilot System v3.1 — Sprint 2 (PB-08).
// The 26 allowed transitions from docs/transition-matrix.md §3 — the
// COMPLETE list. Any ordered pair of distinct states not in this table
// is FORBIDDEN (210 ordered pairs minus 26 allowed = 184 forbidden),
// and any self-transition is rejected as a no-op. Sprint 2 must not
// invent a transition outside this table. Guard logic lives in
// transactions.service.ts; this file is the table itself so tests can
// sweep all 210 pairs against it independently of the service.

import type { TransactionState } from '../common/transaction-state';

/**
 * Counting reconciliation, recorded honestly because the matrix counts
 * two ways at once: transition-matrix.md §3 lists 26 ROWS and computes
 * 210 − 26 = 184 forbidden pairs, but row 22 (DISPUTED → pre-dispute
 * state) is ONE row covering SIX concrete targets. Concrete ordered
 * pairs are therefore 25 fixed pairs + 6 return targets = 31 allowed
 * pairs, and 210 − 31 = 179 unconditionally forbidden pairs. The
 * remaining 5 return-target pairs are CONDITIONALLY forbidden: a return
 * to a state the transaction never held before the dispute is rejected.
 * This table keeps exactly 26 rows, matching the matrix row count, and
 * findTransitionRow resolves row 22 against the eligible targets.
 */
export const DISPUTED_RETURN = 'PRE_DISPUTE_STATE' as const;

export interface TransitionRow {
  from: TransactionState;
  to: TransactionState | typeof DISPUTED_RETURN;
  permission: string;
  action: string;
}

export const TRANSITION_TABLE: readonly TransitionRow[] = [
  { from: 'DRAFT', to: 'PENDING_REVIEW', permission: 'transactions.submit_review', action: 'TRANSACTION_SUBMITTED_FOR_REVIEW' },
  { from: 'DRAFT', to: 'CANCELLED', permission: 'transactions.cancel', action: 'TRANSACTION_CANCELLED' },
  { from: 'PENDING_REVIEW', to: 'ACCEPTED', permission: 'transactions.accept_contract', action: 'CONTRACT_ACCEPTED' },
  { from: 'PENDING_REVIEW', to: 'CANCELLED', permission: 'transactions.cancel', action: 'TRANSACTION_CANCELLED' },
  { from: 'ACCEPTED', to: 'PENDING_REVIEW', permission: 'transactions.request_amendment', action: 'CONTRACT_AMENDMENT_REQUESTED' },
  { from: 'ACCEPTED', to: 'AWAITING_FUNDING_CONFIRMATION', permission: 'transactions.issue_voucher', action: 'FUNDING_AWAITING_STARTED' },
  { from: 'ACCEPTED', to: 'CANCELLED', permission: 'transactions.cancel', action: 'TRANSACTION_CANCELLED' },
  { from: 'AWAITING_FUNDING_CONFIRMATION', to: 'FUNDED_CONFIRMED', permission: 'transactions.confirm_funding', action: 'FUNDING_CONFIRMED' },
  { from: 'AWAITING_FUNDING_CONFIRMATION', to: 'DISPUTED', permission: 'transactions.open_dispute', action: 'DISPUTE_OPENED' },
  { from: 'AWAITING_FUNDING_CONFIRMATION', to: 'CANCELLED', permission: 'transactions.cancel', action: 'TRANSACTION_CANCELLED' },
  { from: 'FUNDED_CONFIRMED', to: 'IN_FULFILMENT', permission: 'transactions.start_fulfilment', action: 'FULFILMENT_STARTED' },
  { from: 'FUNDED_CONFIRMED', to: 'DISPUTED', permission: 'transactions.open_dispute', action: 'DISPUTE_OPENED' },
  { from: 'IN_FULFILMENT', to: 'DELIVERED', permission: 'transactions.record_delivery', action: 'PRODUCT_ARRIVED_AT_DELIVERY_POINT' },
  { from: 'IN_FULFILMENT', to: 'DISPUTED', permission: 'transactions.open_dispute', action: 'DISPUTE_OPENED' },
  { from: 'DELIVERED', to: 'RECEIPT_CONFIRMED', permission: 'transactions.record_receipt', action: 'RECEIPT_CONFIRMED_BY_BUYER' },
  { from: 'DELIVERED', to: 'DISPUTED', permission: 'transactions.open_dispute', action: 'DISPUTE_OPENED' },
  { from: 'RECEIPT_CONFIRMED', to: 'SETTLEMENT_PENDING', permission: 'transactions.prepare_settlement', action: 'SETTLEMENT_PREPARED' },
  { from: 'RECEIPT_CONFIRMED', to: 'DISPUTED', permission: 'transactions.open_dispute', action: 'DISPUTE_OPENED' },
  { from: 'SETTLEMENT_PENDING', to: 'SETTLED', permission: 'transactions.record_settlement', action: 'SETTLEMENT_RECORDED' },
  { from: 'SETTLEMENT_PENDING', to: 'DISPUTED', permission: 'transactions.open_dispute', action: 'DISPUTE_OPENED' },
  { from: 'SETTLED', to: 'COMPLETED', permission: 'transactions.complete', action: 'TRANSACTION_COMPLETED' },
  { from: 'DISPUTED', to: DISPUTED_RETURN, permission: 'transactions.resolve_dispute', action: 'DISPUTE_RESOLVED_RETURNED' },
  { from: 'DISPUTED', to: 'REFUND_PENDING', permission: 'transactions.resolve_dispute', action: 'DISPUTE_RESOLVED_REFUND' },
  { from: 'DISPUTED', to: 'CANCELLED', permission: 'transactions.resolve_dispute', action: 'DISPUTE_RESOLVED_CANCELLED' },
  { from: 'REFUND_PENDING', to: 'REFUNDED', permission: 'transactions.record_refund', action: 'REFUND_RECORDED' },
  { from: 'REFUNDED', to: 'COMPLETED', permission: 'transactions.complete', action: 'TRANSACTION_COMPLETED' },
];

/** States a DISPUTED transaction may return to under row 22 (row 22 only
 * restores a state the transaction actually held before the dispute). */
export const DISPUTE_RETURN_TARGETS: readonly TransactionState[] = [
  'AWAITING_FUNDING_CONFIRMATION',
  'FUNDED_CONFIRMED',
  'IN_FULFILMENT',
  'DELIVERED',
  'RECEIPT_CONFIRMED',
  'SETTLEMENT_PENDING',
];

export function findTransitionRow(
  from: TransactionState,
  to: TransactionState,
): TransitionRow | undefined {
  if (from === 'DISPUTED' && (DISPUTE_RETURN_TARGETS as readonly string[]).includes(to)) {
    return TRANSITION_TABLE.find((row) => row.to === DISPUTED_RETURN);
  }
  return TRANSITION_TABLE.find((row) => row.from === from && row.to === to);
}
