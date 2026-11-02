// Pilot System v3.1 — Sprint 2 (PB-08).
// EXACTLY the 15 unified states from CORE PROMPT §8, in order. No more,
// no less. Audit-event names (BUYER_ARRIVED_AT_HANDOVER,
// HANDOVER_INSPECTION_COMPLETED) are deliberately NOT in this list:
// they are DeliveryEvent rows, never states.

export const TRANSACTION_STATES = [
  'DRAFT',
  'PENDING_REVIEW',
  'ACCEPTED',
  'AWAITING_FUNDING_CONFIRMATION',
  'FUNDED_CONFIRMED',
  'IN_FULFILMENT',
  'DELIVERED',
  'RECEIPT_CONFIRMED',
  'SETTLEMENT_PENDING',
  'SETTLED',
  'DISPUTED',
  'REFUND_PENDING',
  'REFUNDED',
  'COMPLETED',
  'CANCELLED',
] as const;

export type TransactionState = (typeof TRANSACTION_STATES)[number];

export const PARTY_ROLES = ['BUYER', 'SELLER'] as const;
export type PartyRole = (typeof PARTY_ROLES)[number];

export const USER_STATUSES = ['APPROVED', 'NOT_APPROVED', 'SUSPENDED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const DELIVERY_EVENT_TYPES = [
  'SELLER_ARRIVED_AT_DELIVERY_POINT',
  'HANDOVER_READINESS_NOTIFIED',
  'BUYER_ARRIVED_AT_HANDOVER',
  'HANDOVER_INSPECTION_COMPLETED',
  'OPERATIONAL_EXCEPTION_PRODUCT_ABSENT',
] as const;
export type DeliveryEventType = (typeof DELIVERY_EVENT_TYPES)[number];
