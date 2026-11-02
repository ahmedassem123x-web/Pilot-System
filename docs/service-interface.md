# Service Interface — Sprint 2 → Sprint 3 Wiring Contract

Status: Sprint 2 deliverable (2026-11-02). This document is the contract
Sprint 3 must follow when wiring HTTP controllers and the Prisma store
onto the Sprint 2 services WITHOUT changing any Guard logic.

## Rule 0 — what must not change

- `src/transactions/transition-table.ts`: the 26 rows. No row added,
  removed, or re-permissioned without a signed written change request.
- `src/transactions/transactions.service.ts`: every Guard check, every
  error code, every audit action string. Sprint 3 adds transport
  (controllers, DTO validation, JWT extraction) around it, never logic
  inside it.
- `src/store/repository.ts`: the `Store` interface. Sprint 3 provides a
  Prisma implementation of it; services keep depending on the interface.

## Services (all in backend/src, all constructible with `new`)

| Service | Constructor | Owns |
| --- | --- | --- |
| `AuditService` (audit/) | `(store: Store)` | Append-only audit writes; update/delete refuse with `IMMUTABLE_ROW`. |
| `UsersService` (users/) | `(store: Store)` | Person identity: one UUID + one whatsapp_number + status. No role on User. |
| `AuthService` (auth/) | `({ jwtSecret?, jwtExpiresInSeconds? })` | argon2id hash/verify; JWT sign/verify. Throws when no secret is configured. No fallback secret. |
| `RbacService` (auth/) | `(store: Store)` | Roles, permissions, assignments, effective permissions. Permission names are in `TRANSACTION_PERMISSIONS` (auth/rbac.service.ts). |
| `TransactionsService` (transactions/) | `(store: Store, audit: AuditService)` | Transactions, parties, contract versions, evidence, coordination, delivery events, disputes, settlement summaries, the 15-state machine, amendment policy. |

## NestJS modules (already wired in app.module.ts)

`StoreModule` (global, provides `InMemoryStore`), `AuditModule`,
`UsersModule`, `AuthModule`, `TransactionsModule`. `GET /health` still
works (app.controller.spec.ts). HTTP controllers for transactions are
Sprint 3 work: they must extract the actor (id, role, permissions) from
the JWT via `JwtAuthGuard` + `PermissionsGuard`
(`RequirePermission('transactions.…')`) and pass it to
`TransactionsService.transition(...)`. A controller without the guard
cannot bypass the service-layer permission check (403 either way).

## Actor shape (passed to every transition)

```ts
interface Actor {
  id: string; // StaffUser id for staff actions
  role: 'STAFF' | 'BUYER' | 'SELLER';
  permissions: string[]; // effective permissions (RbacService)
}
```

## Transition call

```ts
txs.transition(transactionId, actor, toState, input?)
```

- `toState`: one of the 15 states. Self-transitions reject with
  `SELF_TRANSITION`; non-table pairs reject with
  `FORBIDDEN_TRANSITION`; missing permission rejects with
  `PERMISSION_DENIED` (HTTP 403); missing evidence rejects with
  `GUARD_FAILED` (HTTP 422). Every rejection writes one
  `TRANSITION_REJECTED` AuditEvent before throwing.
- `input.correlationId` is optional; a UUID is generated when absent.
- Per-row inputs (see transactions.service.ts `TransitionInput`):
  cancellation rows need `cancellationReason` (+ `bothPartiesAgreement`
  for ACCEPTED/AWAITING rows); row 5 needs `buyerApprovedAmendment`,
  `sellerApprovedAmendment`, `newContractContent`; row 6 needs
  `voucher` (buyerName, sellerName, purpose, amount, currency,
  paymentReferenceText); row 11 needs `shippingConfirmed: true`;
  dispute rows need `disputeReason` + `disputeEvidenceFileIds` (array,
  possibly empty); row 17 needs `settlementSummary` (deposit_reference
  must match the coordination record) and must NOT set
  `beneficiaryChangedFromWhatsappMessage: true`; row 25 needs
  `refundConfirmation` (settlementReference, executedAmount, currency,
  beneficiary, executionDate, confirmationDocument, optional
  receivingMethod).

## Evidence-recording calls (each writes its own AuditEvent)

- `recordPartyAcceptance(txId, 'BUYER'|'SELLER', whatsappMessageId, recordedByStaffId)`
  — writes a MessageLog (INBOUND) + `PARTY_ACCEPTANCE` audit carrying
  the current version hash. Row 3 requires one BUYER + one SELLER
  record for the current hash plus matching MessageLogs.
- `recordHandoverAcceptance(txId, whatsappMessageId, buyerUserId)` —
  writes a MessageLog + `BUYER_HANDOVER_ACCEPT` audit. Row 15 requires
  this plus both handover DeliveryEvents and no unresolved
  product-absent exception.
- `recordDeliveryEvent(txId, eventType, recordedBy, note?)` — DeliveryEvent
  + `DELIVERY_EVENT_RECORDED` audit. Event types are the five values in
  common/transaction-state.ts (never states).
- `resolveOperationalException(txId, staffId)` — audit
  `OPERATIONAL_EXCEPTION_RESOLVED`. Row 15 counts exceptions vs
  resolutions; an unresolved exception blocks acceptance.
- `submitPaymentEvidence({...})` — always stores status
  `PAYMENT_EVIDENCE_SUBMITTED`. There is no update path for evidence
  status; the type has exactly one value.
- `recordCoordination({...})` — deposit-reference uniqueness is
  enforced by the store; a duplicate throws
  `DUPLICATE_DEPOSIT_REFERENCE` and writes a
  `COORDINATION_REJECTED_DUPLICATE_REFERENCE` audit for manual review.
- `recordSettlementConfirmation(summaryId, { settlementReference, confirmationAt, actorId })`
  — sets the summary's settlement_reference + institution_confirmation_at
  and the coordination record's settlement_reference. Row 19 requires this.
- `resolveDispute(txId, { outcome: 'REFUND'|'PROCEED'|'CANCELLED', resolution, resolvedBy })`
  — marks the latest OPEN dispute RESOLVED + `DISPUTE_RESOLVED` audit.
  Rows 22/23/24 check outcome, resolution text, resolver and timestamp.
- `requestAmendment(txId, actor, { newContent, buyerApproved?, sellerApproved? })`
  — DRAFT/PENDING_REVIEW: new version, old preserved. ACCEPTED: row 5
  transition. FUNDED_CONFIRMED or later: throws `AMENDMENT_FORBIDDEN`
  + `AMENDMENT_REJECTED` audit.

## Frozen accepted version (no version-row mutation, by design)

Contract version rows are immutable: acceptance does NOT update
`accepted_at`/`accepted_by` on the row (the store refuses). The frozen
proof is: version `content_hash` + `CONTRACT_ACCEPTED` audit row
(carrying `version_hash`, `version_number`, timestamp, recording staff
id) + the two `PARTY_ACCEPTANCE` audits + their MessageLogs. All four
must agree; a mismatch is a staff-review exception. Row 6 re-checks the
`CONTRACT_ACCEPTED` audit for the current hash before issuing the voucher.

## Current version rule (binding, transition-matrix.md §8a)

Current = highest `version_number` per transaction.
`superseded_by` is ignored for currency and never back-filled.

## Separation of duties (binding, backend Guard + test)

Row 19 and row 25 compare the acting staff id against the funding
coordination record's `staff_id` (the record carrying the deposit
reference) and reject with `SEPARATION_OF_DUTIES_VIOLATION` (403) on a
match. This cannot be a single-table DB constraint; do not claim it is.

## Sprint 3 Store replacement checklist

The Prisma `Store` must implement every method in repository.ts with
the same semantics, including: unique whatsapp_number, unique
(transaction_id, role), unique deposit_reference (NULLs distinct),
unique whatsapp_message_id, unique (transaction_id, version_number),
`update/delete` on audit_events and contract_versions raising
`IMMUTABLE_ROW` (in addition to the migration triggers), and
`currentVersion` = highest version_number. Map `amount` (number here)
to Prisma Decimal. Keep the in-memory class for tests; do not delete it.

## Explicitly NOT in this interface

No wallet, balance, ledger, gateway, bank API, fee, commission,
multi-currency accounting, multi-institution support, customer portal,
broadcast, store sync, AI decision, or project-management surface of
any kind. No endpoint moves money. The only panel is the transaction
operations panel (Sprint 3). No timer, queue job, reminder or
escalation may perform a transition; the backend contains no such path
(proven by no-implicit-acceptance.spec.ts).
