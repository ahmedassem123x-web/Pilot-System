# Transition Matrix — Pilot System v3.1 (Sprint 1, PB-05)

Status: DRAFT FOR WRITTEN ACCEPTANCE — this matrix must be accepted in writing
by Ahmed before ANY Sprint 2 code is written. Sprint 2 must not invent a
transition that is not listed here as allowed, and must not implement a
transition listed here as forbidden.

Governing sources: CORE PROMPT §8 (15 states), §9 (Sold as Seen),
§10 (amendment policy), §11 (financial mechanism), §14 (separation of
duties), §15 (critical tests). Data model: `backend/prisma/schema.prisma`.

General rules that apply to EVERY row below (they are part of every Guard,
even where a row shortens them):

- A transition that fails its Guard is REJECTED with a clear error code AND
  an AuditEvent entry recording the rejected attempt (actor, from-state,
  attempted to-state, reason). A silent rejection, or a rejection with no
  audit entry, is a failure of the matrix, not a pass.
- Every transition writes exactly one AuditEvent with previous_state and
  new_state, actor_id, actor_role, correlation_id and timestamp. State
  changes with no audit entry do not exist in this system.
- Permissions are enforced in the BACKEND (403 on violation), never only
  in the UI. Permission names below are the Sprint 2 Guard names; the
  RBAC tables themselves are in `schema.prisma` (StaffUser / Role /
  Permission / RolePermission / StaffUserRole).
- Separation of duties (CORE PROMPT §14.1): the staff member who records
  a funding confirmation MUST NOT approve settlement for the SAME
  transaction. The Guard compares
  FinancialCoordinationRecord.staff_id with the settlement recorder for
  that transaction and rejects on a match. The database alone cannot
  express this cross-row rule (see schema header) — it is a backend Guard
  plus critical test 5, not a schema claim.
- No transition in this matrix moves money. SETTLED / REFUNDED / COMPLETED
  record that an EXTERNAL institution has confirmed execution, with its
  references. They never execute a transfer, disbursement or refund.
- No scheduled job, queue job, reminder or escalation may perform, trigger
  or imply any transition in this matrix. Jobs may only remind or escalate
  to a HUMAN. Any job that accepts, settles, closes or refunds is a
  forbidden transition (see §5).
- CANCELLED is a terminal closing state, never a deletion. Cancelled data
  remains for audit. COMPLETED is likewise terminal: no outgoing transition
  exists from COMPLETED or from CANCELLED.

## 1. The 15 states, in order

Order below is the CORE PROMPT §8 order. It is a listing order, NOT a
claim that every state follows the previous one in a single straight line:
DISPUTED, REFUND_PENDING, REFUNDED and CANCELLED are branches, and §3
is the only authority on which moves are legal.

| # | State | Meaning | Terminal? |
| --- | --- | --- | --- |
| 1 | DRAFT | Transaction drafted, not yet submitted for review. | No |
| 2 | PENDING_REVIEW | Submitted; contract version under review / awaiting acceptance. | No |
| 3 | ACCEPTED | Contract version accepted by both parties; frozen reference set. | No |
| 4 | AWAITING_FUNDING_CONFIRMATION | Voucher issued; buyer evidence may be submitted; NO funding confirmed yet. | No |
| 5 | FUNDED_CONFIRMED | Institution confirmed AND deposit reference recorded (both required). | No |
| 6 | IN_FULFILMENT | Funded; seller shipping / fulfilment under way. Amendment now forbidden. | No |
| 7 | DELIVERED | Seller confirms product arrived at the agreed delivery point; readiness notice sent to buyer. This is arrival at the point, NOT buyer acceptance. | No |
| 8 | RECEIPT_CONFIRMED | Buyer EXPLICITLY accepted at first actual handover after actual inspection. Only this state is buyer acceptance. | No |
| 9 | SETTLEMENT_PENDING | Manual settlement summary prepared; awaiting institution settlement confirmation. | No |
| 10 | SETTLED | Institution confirmed settlement execution, with settlement reference. | No |
| 11 | DISPUTED | An open dispute freezes closure and settlement (see §4). | No |
| 12 | REFUND_PENDING | Human resolution decided refund; awaiting institution refund execution. | No |
| 13 | REFUNDED | Institution confirmed refund execution, with settlement/refund reference. | No — only exit is COMPLETED |
| 14 | COMPLETED | Full cycle documented and closed (from SETTLED or from REFUNDED only). | Yes |
| 15 | CANCELLED | Closed without settlement; data retained for audit. | Yes |

Total ordered state pairs excluding self-transitions: 15 × 14 = 210.
Allowed transitions in §3: 26. Forbidden transitions: 210 − 26 = 184.
A self-transition (state → itself) is not a transition at all and is
rejected; it is not counted in either total.

## 2. Audit events that are NOT states

`BUYER_ARRIVED_AT_HANDOVER` and `HANDOVER_INSPECTION_COMPLETED` are
DeliveryEvent rows (audit events), NEVER TransactionState values. Adding
either as a 16th state is a v3.1 violation. The full handover event set
in the schema is:

- SELLER_ARRIVED_AT_DELIVERY_POINT — seller arrival at the point.
- HANDOVER_READINESS_NOTIFIED — readiness notification sent to buyer.
- BUYER_ARRIVED_AT_HANDOVER — buyer actually arrived (step 3 of §6).
- HANDOVER_INSPECTION_COMPLETED — inspection actually completed (step 5).
- OPERATIONAL_EXCEPTION_PRODUCT_ABSENT — buyer arrived, product was NOT
  there (step 4). This event advances NO state, notifies operations staff,
  and must never be treated as receipt or acceptance.

A transaction may hold these events while its state stays DELIVERED.
Only an explicit buyer ACCEPT after both arrival and inspection events
may move DELIVERED → RECEIPT_CONFIRMED (§3, row 15).

## 3. Allowed transitions — the complete list (26)

Reading a row: Guard = required permission AND required evidence/reference.
If any Guard element is missing, the transition is rejected (§5 applies).

| # | From → To | Triggering actor | Guard: permission + required evidence/reference | Resulting audit event (action) |
| --- | --- | --- | --- | --- |
| 1 | DRAFT → PENDING_REVIEW | Staff (transaction creator) | `transactions.submit_review`. Exactly one BUYER and one SELLER TransactionParty; contract version 1 exists with SHA-256 content_hash; amount, currency, product_description, quantity, delivery_point, cancellation_terms present. | TRANSACTION_SUBMITTED_FOR_REVIEW |
| 2 | DRAFT → CANCELLED | Staff (transaction creator) | `transactions.cancel`. Cancellation reason recorded. No funding can exist in DRAFT; if any evidence row exists it is retained, not deleted. | TRANSACTION_CANCELLED |
| 3 | PENDING_REVIEW → ACCEPTED | Buyer AND Seller (explicit acceptance, recorded by Staff) | `transactions.accept_contract`. Current ContractVersion has non-null accepted_at AND audit evidence of explicit ACCEPT from BOTH buyer and seller for that version hash (WhatsApp MessageLogs + AuditEvents). See schema-interpretation note below this table. | CONTRACT_ACCEPTED |
| 4 | PENDING_REVIEW → CANCELLED | Staff | `transactions.cancel`. Withdrawal/cancellation reason recorded; no accepted version exists for this transaction. | TRANSACTION_CANCELLED |
| 5 | ACCEPTED → PENDING_REVIEW | Staff, on amendment request (either party) with BOTH parties' approval to amend | `transactions.request_amendment`. State is ACCEPTED (before funding/shipping — later states are forbidden, see §5). Both parties' approval recorded; a NEW ContractVersion row created with a new hash; previous version preserved untouched; new version accepted_at is NULL until re-accepted via row 3. | CONTRACT_AMENDMENT_REQUESTED |
| 6 | ACCEPTED → AWAITING_FUNDING_CONFIRMATION | Staff | `transactions.issue_voucher`. Accepted version is frozen (hash + timestamp + messages + audit agree); payment-instruction voucher issued/recorded per CORE PROMPT §11.1 (configurable fields only — no financial data fixed before institution approval). | FUNDING_AWAITING_STARTED |
| 7 | ACCEPTED → CANCELLED | Staff, with BOTH parties' agreement recorded | `transactions.cancel`. No FinancialCoordinationRecord with institution_confirmed = true and no deposit reference for this transaction. | TRANSACTION_CANCELLED |
| 8 | AWAITING_FUNDING_CONFIRMATION → FUNDED_CONFIRMED | Staff (funding confirmer) | `transactions.confirm_funding`. BOTH funding-gate conditions true: (a) FinancialCoordinationRecord.institution_confirmed = true, AND (b) deposit_reference non-NULL (database-unique). Buyer PaymentEvidence alone is NEVER sufficient; a WhatsApp message alone is NEVER sufficient. Duplicate deposit reference fails at the database and surfaces to staff for manual review. | FUNDING_CONFIRMED |
| 9 | AWAITING_FUNDING_CONFIRMATION → DISPUTED | Buyer, Seller, or Staff | `transactions.open_dispute`. Dispute reason + evidence_file_ids recorded; Dispute row created with status OPEN. Financial steps freeze from this point (§4). | DISPUTE_OPENED |
| 10 | AWAITING_FUNDING_CONFIRMATION → CANCELLED | Staff, with BOTH parties' agreement recorded | `transactions.cancel`. No institution_confirmed record and no deposit reference for this transaction. | TRANSACTION_CANCELLED |
| 11 | FUNDED_CONFIRMED → IN_FULFILMENT | Staff | `transactions.start_fulfilment`. State is FUNDED_CONFIRMED; seller shipping/fulfilment confirmation recorded. From this state onward, contract amendment is FORBIDDEN (§5). | FULFILMENT_STARTED |
| 12 | FUNDED_CONFIRMED → DISPUTED | Buyer, Seller, or Staff | `transactions.open_dispute`. Dispute reason + evidence recorded; Dispute OPEN. | DISPUTE_OPENED |
| 13 | IN_FULFILMENT → DELIVERED | Seller (arrival confirmed, recorded by Staff) | `transactions.record_delivery`. DeliveryEvent SELLER_ARRIVED_AT_DELIVERY_POINT recorded; readiness notification sent to buyer (MessageLog, not dry-run). This is steps 1–2 of §6. | PRODUCT_ARRIVED_AT_DELIVERY_POINT |
| 14 | IN_FULFILMENT → DISPUTED | Buyer, Seller, or Staff | `transactions.open_dispute`. Dispute reason + evidence recorded; Dispute OPEN. | DISPUTE_OPENED |
| 15 | DELIVERED → RECEIPT_CONFIRMED | Buyer ONLY, by EXPLICIT accept | `transactions.record_receipt`. ALL required: DeliveryEvent BUYER_ARRIVED_AT_HANDOVER recorded, DeliveryEvent HANDOVER_INSPECTION_COMPLETED recorded, buyer explicit ACCEPT recorded (message + audit), and NO unresolved OPERATIONAL_EXCEPTION_PRODUCT_ABSENT for this handover. Time, silence and jobs can never satisfy this Guard (§5, §6). | RECEIPT_CONFIRMED_BY_BUYER |
| 16 | DELIVERED → DISPUTED | Buyer (explicit REJECT) or Staff | `transactions.open_dispute`. Explicit REJECT reason, or dispute reason + evidence, recorded; Dispute OPEN. A rejection does NOT auto-refund: refund requires rows 23 then 25. | DISPUTE_OPENED |
| 17 | RECEIPT_CONFIRMED → SETTLEMENT_PENDING | Staff | `transactions.prepare_settlement`. SettlementSummary prepared MANUALLY: deposit_reference matches the coordination record, amount, currency, beneficiary_name, delivery_proof_or_dispute_outcome present. Beneficiary/destination NOT changed from a WhatsApp message alone; any discrepancy = follow-up case, transition rejected until resolved. | SETTLEMENT_PREPARED |
| 18 | RECEIPT_CONFIRMED → DISPUTED | Buyer, Seller, or Staff | `transactions.open_dispute`. Dispute reason + evidence recorded; Dispute OPEN. (A post-acceptance dispute does not retroactively undo the recorded acceptance; it freezes settlement until human resolution.) | DISPUTE_OPENED |
| 19 | SETTLEMENT_PENDING → SETTLED | Staff (settlement approver — MUST differ from the funding confirmer for this transaction) | `transactions.record_settlement`. SettlementSummary.institution_confirmation_at non-NULL AND FinancialCoordinationRecord.settlement_reference recorded AND separation-of-duties check passes (settlement recorder ≠ funding confirmer). Any missing element rejects. | SETTLEMENT_RECORDED |
| 20 | SETTLEMENT_PENDING → DISPUTED | Buyer, Seller, or Staff | `transactions.open_dispute`. Dispute reason + evidence recorded; Dispute OPEN. Settlement is frozen until resolution. | DISPUTE_OPENED |
| 21 | SETTLED → COMPLETED | Staff | `transactions.complete`. Full acceptance + settlement cycle documented: RECEIPT_CONFIRMED occurred, SettlementSummary + institution confirmation present, NO open dispute. This is the ONLY settlement-route to COMPLETED. | TRANSACTION_COMPLETED |
| 22 | DISPUTED → (pre-dispute state restored) | Staff (dispute resolver, human only) | `transactions.resolve_dispute`. Dispute RESOLVED with resolution_outcome = PROCEED, resolution text + resolved_by + resolved_at recorded, target state EQUALS the audit-recorded pre-dispute state, and the return restores a fact already recorded before the dispute — it creates NO new funding, settlement or acceptance fact. New funding/settlement/acceptance must still be earned through rows 8, 15 and 19. Eligible targets are only states the transaction actually held before the dispute (AWAITING_FUNDING_CONFIRMATION, FUNDED_CONFIRMED, IN_FULFILMENT, DELIVERED, RECEIPT_CONFIRMED, SETTLEMENT_PENDING). | DISPUTE_RESOLVED_RETURNED |
| 23 | DISPUTED → REFUND_PENDING | Staff (dispute resolver, human only) | `transactions.resolve_dispute`. Dispute RESOLVED with resolution_outcome = REFUND, resolution text + resolved_by + resolved_at recorded. No settlement executed yet for this transaction. | DISPUTE_RESOLVED_REFUND |
| 24 | DISPUTED → CANCELLED | Staff (dispute resolver, human only) | `transactions.resolve_dispute`. Dispute RESOLVED with resolution_outcome = CANCELLED, resolution text + resolved_by + resolved_at recorded. Data retained for audit. | DISPUTE_RESOLVED_CANCELLED |
| 25 | REFUND_PENDING → REFUNDED | Staff (settlement approver — same separation-of-duties check as row 19: recorder ≠ funding confirmer) | `transactions.record_refund`. Institution settlement/refund reference recorded on the coordination record AND institution confirmation of refund execution recorded (confirmation document/notice, executed amount + currency, final beneficiary + receiving method if any, execution date, recording staff member). Missing reference or confirmation rejects. | REFUND_RECORDED |
| 26 | REFUNDED → COMPLETED | Staff | `transactions.complete`. Refund execution fully documented (original deposit reference, settlement/refund reference, executed amount + currency, final beneficiary, execution date, confirmation document, recording staff member) AND no open dispute. This is the ONLY refund-route to COMPLETED. | TRANSACTION_COMPLETED |

Schema-interpretation note (row 3, recorded, not guessed away):
ContractVersion.accepted_by is singular in CORE PROMPT §7, so it cannot by
itself prove acceptance by TWO parties. Sprint 2's Guard for row 3 must
therefore require the two party-acceptance AuditEvents + matching WhatsApp
MessageLogs for the version hash, and must treat accepted_by as the
recording staff member's id ONLY if Sprint 2 review confirms that reading
in writing. If review rejects that reading, Sprint 2 must add a
ContractAcceptance record (new migration, new table) BEFORE coding row 3.
Row 3 must not be implemented on accepted_by alone.

## 4. Dispute freezing rule

While a transaction is DISPUTED (Dispute status OPEN):

- Closure is BLOCKED: no transition to COMPLETED, SETTLED or REFUNDED
  from DISPUTED, and no transition out of DISPUTED except rows 22, 23, 24.
- Settlement is BLOCKED: no settlement summary may be marked executed,
  and no settlement/refund reference recorded during the dispute may be
  treated as execution until the dispute is resolved by a human.
- Financial steps are BLOCKED: no new funding confirmation, fulfilment
  start, delivery acceptance or settlement step may be recorded while
  DISPUTED. The only way forward is human resolution (rows 22–24).
- The dispute itself never decides money: resolution only selects the
  next allowed transition. Execution still requires institution
  confirmation (rows 19, 25).

## 5. Forbidden transitions — complete statement

Every ordered pair of distinct states NOT listed in §3 is FORBIDDEN.
That is 184 forbidden pairs, including all self-transitions as no-ops.
Sprint 2 must reject each with a clear error code + audit entry, and
Sprint 4 must negative-test the dangerous subset below (plus every
prohibition in CORE PROMPT §1.1). The dangerous forbidden transitions,
named explicitly so no reviewer can miss them, are:

1. ANY transition to FUNDED_CONFIRMED without institution confirmation +
   deposit reference. Forbidden in particular: AWAITING_FUNDING_CONFIRMATION
   → FUNDED_CONFIRMED on buyer evidence alone; on a WhatsApp message alone;
   on a receipt image alone; from DRAFT, PENDING_REVIEW or ACCEPTED
   skipping AWAITING_FUNDING_CONFIRMATION; and any re-use of a deposit
   reference already used for another transaction (database-unique).
2. ANY transition to COMPLETED skipping settlement/acceptance. Forbidden
   in particular: DRAFT → COMPLETED, PENDING_REVIEW → COMPLETED,
   ACCEPTED → COMPLETED, AWAITING_FUNDING_CONFIRMATION → COMPLETED,
   FUNDED_CONFIRMED → COMPLETED, IN_FULFILMENT → COMPLETED,
   DELIVERED → COMPLETED, RECEIPT_CONFIRMED → COMPLETED,
   SETTLEMENT_PENDING → COMPLETED, DISPUTED → COMPLETED,
   REFUND_PENDING → COMPLETED. Only SETTLED → COMPLETED (row 21) and
   REFUNDED → COMPLETED (row 26) exist.
3. ANY transition out of DISPUTED to a financial or acceptance step
   without human resolution. Forbidden in particular: DISPUTED →
   FUNDED_CONFIRMED, DISPUTED → SETTLED, DISPUTED → REFUNDED,
   DISPUTED → RECEIPT_CONFIRMED as a NEW acceptance, DISPUTED → COMPLETED,
   and DISPUTED → IN_FULFILMENT / SETTLEMENT_PENDING / any other state
   without a RESOLVED dispute record (resolution, resolver, timestamp).
   Row 22 is the sole return path, and it restores a prior fact only.
4. ANY contract amendment after FUNDED_CONFIRMED or IN_FULFILMENT.
   Forbidden in particular: any new ContractVersion becoming the accepted
   version after funding or shipping; FUNDED_CONFIRMED → PENDING_REVIEW;
   IN_FULFILMENT → PENDING_REVIEW; DELIVERED → PENDING_REVIEW for
   amendment. The only amendment path is row 5 (ACCEPTED →
   PENDING_REVIEW, before funding/shipping, both parties' approval,
   new version + re-acceptance) and, before acceptance, a new version
   while still in DRAFT/PENDING_REVIEW with the old version preserved.
   After funding/shipping the path is dispute, or a later documented
   agreement under the contract — never an amended version.
5. ANY acceptance by time, silence, or scheduled job. Forbidden in
   particular: any transition to RECEIPT_CONFIRMED or COMPLETED triggered
   by elapsed time (no 24/48/72-hour window exists), by buyer silence, by
   non-response, by a BullMQ/Redis job, by a database trigger, by a
   database default, or by any automatic UI step. Allowed: human
   reminders and human escalation ONLY when there is no response.
   The database must contain NO trigger, job or default that produces
   acceptance (verified by schema + migration review, not by assertion).
6. ANY shipping on evidence alone: AWAITING_FUNDING_CONFIRMATION →
   IN_FULFILMENT (skipping FUNDED_CONFIRMED) is forbidden. Evidence
   permits nothing until the institution gate in row 8 passes.
7. ANY settlement without a coordination record and an external reference:
   SETTLEMENT_PENDING → SETTLED without a FinancialCoordinationRecord and
   settlement reference, and REFUND_PENDING → REFUNDED without an
   institution settlement/refund reference, are forbidden.
8. ANY outgoing transition from a terminal state: COMPLETED → anything
   and CANCELLED → anything are forbidden. Reopening a completed or
   cancelled transaction requires a NEW transaction, never a transition.
9. ANY beneficiary/destination change from a WhatsApp message alone, and
   any settlement/recording step that treats a WhatsApp message as
   institution confirmation, is forbidden as a transition Guard input:
   WhatsApp messages are evidence and notifications, never confirmation.
10. No transition, table, role, permission, KPI, report or budget for
    Control Tower exists in this matrix or in the schema: it is excluded
    by design (named here once, as a prohibition, not as an artefact) —
    the single allowed panel is the transaction operations panel, and
    this matrix covers only its transaction lifecycle.

## 6. Sold-as-Seen handover sequence (CORE PROMPT §9) — exact order, no skipping

Final acceptance or rejection happens ONLY at the first ACTUAL handover
with ACTUAL inspection, in this exact sequence:

1. Seller confirms the product has arrived at the agreed delivery point.
   → DeliveryEvent SELLER_ARRIVED_AT_DELIVERY_POINT; state
   IN_FULFILMENT → DELIVERED (row 13).
2. System sends a readiness notification to the buyer.
   → DeliveryEvent HANDOVER_READINESS_NOTIFIED; MessageLog (not dry-run
   when actually sent; dry-run rows are labelled dry-run everywhere).
3. Record BUYER_ARRIVED_AT_HANDOVER when the buyer actually arrives.
   → DeliveryEvent row; state stays DELIVERED.
4. If the buyer arrives and the product is NOT there: record an
   OPERATIONAL EXCEPTION (DeliveryEvent
   OPERATIONAL_EXCEPTION_PRODUCT_ABSENT), notify operations staff, and
   do NOT treat the product as received or accepted. State stays
   DELIVERED; rows 15/16 are NOT available until the exception is
   resolved by staff and a real handover occurs.
5. Record HANDOVER_INSPECTION_COMPLETED after inspection.
   → DeliveryEvent row; state stays DELIVERED.
6. Buyer EXPLICITLY chooses: ACCEPT or REJECT.
   → ACCEPT: DELIVERED → RECEIPT_CONFIRMED (row 15, all Guards met).
   → REJECT: DELIVERED → DISPUTED (row 16, reason recorded).

Explicit prohibitions in this mechanism (all are forbidden transitions
under §5, restated here so the handover section stands alone):

- NO post-handover inspection window of 24, 48, or 72 hours.
- Silence is NOT acceptance. Elapsed time is NOT acceptance.
- NO scheduled job may accept, settle, or close. Human reminders and
  human escalation only, when there is no response.
- NO automatic transition to final acceptance in the UI or in the
  database. No trigger, job, or default in the database produces
  acceptance. (This migration contains triggers ONLY for audit/contract
  immutability — they BLOCK writes; they produce no acceptance, no state
  change, and no financial fact.)

## 7. What Sprint 2 must test from this matrix

- Every row in §3: a positive test (Guard met → transition + audit entry).
- Every row in §3: a negative test per missing Guard element (permission
  missing → 403; evidence/reference missing → rejection + audit entry).
- §5 items 1–10: dedicated negative tests, including critical tests 3, 4,
  5, 6, 9, 10 and 11 of CORE PROMPT §15.
- Dispute freezing (§4): while DISPUTED, attempted closure/settlement
  transitions are rejected and audited.
- Handover (§6): acceptance without both handover events is rejected;
  acceptance after an unresolved product-absent exception is rejected;
  acceptance by simulated time-passage / job is impossible (no such code
  path exists to test — the test asserts absence in code + jobs + triggers).

AWAITING Ahmed's written acceptance before any Sprint 2 code.

## 8. AMENDMENT NOTE — Sprint 2 gate resolutions (2026-11-02, authorised by Ahmed's instruction to run all sprints)

Resolution (a) — `ContractVersion.superseded_by` (insert-only, UPDATE blocked):
- The current accepted/draft version of a transaction is determined SOLELY by the highest `version_number` for that transaction. `superseded_by` is NOT used to determine currency and MUST be ignored by all Sprint 2+ code for that purpose.
- `superseded_by` may only be populated at insert time; it is never back-filled by update (UPDATE on `contract_versions` is blocked by the immutability trigger). No schema change is made for this issue, and no migration weakens immutability.
- A new version is created by INSERT with a new `version_number` and a new SHA-256 `content_hash`; the previous version row is never modified.

Resolution (b) — singular `ContractVersion.accepted_by` cannot prove two-party acceptance:
- `accepted_by` records ONLY the staff member who recorded the acceptance (a StaffUser id), NOT a party.
- The PENDING_REVIEW → ACCEPTED Guard (row 3) is satisfied ONLY when, for the current version hash, there exist TWO party-acceptance AuditEvents (one buyer, one seller) PLUS matching WhatsApp MessageLogs. `accepted_by` alone NEVER satisfies row 3.
- No new `ContractAcceptance` table is added: the existing AuditEvent + MessageLog evidence already provides the two-party proof, so adding a table would be scope creep. If a future signed change request requires a dedicated acceptance table, it must arrive as a NEW Prisma migration, never by altering the immutability rules.

These resolutions are binding for Sprints 2–5. Any code contradicting them is a compliance failure.
