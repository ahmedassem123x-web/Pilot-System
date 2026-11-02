# UAT Script — Pilot System v3.1 (Sprint 4, PB-27)

Status: SCRIPT ONLY. No UAT session has been run against this script,
and no minutes are signed. UAT minutes are UNSIGNED until Ahmed signs
them — never forge a signature, and never describe this script as
signed minutes.

Who runs it: Ahmed (acceptance authority) with one operations staff
member. Environment: the test deployment (test data only — no real
money, no real financial institution, no final Meta account). Every
step states its expected result; a step whose result differs is a
DEFECT to log, not a step to skip.

Conventions: "Staff" = a logged-in operations-panel user. Amounts are
DESCRIPTIVE ONLY throughout. The panel never executes a transfer,
settlement, or refund — it records that an external institution
confirmed execution.

## Scenario A — Explicit-acceptance path end to end (CORE PROMPT §9, §15 test 9)

| Step | Action | Expected result |
| --- | --- | --- |
| A1 | Staff creates a transaction with one buyer and one seller, a contract version, amount, currency, product, quantity, delivery point, cancellation terms. | Transaction exists in DRAFT. |
| A2 | Staff submits it for review. | State PENDING_REVIEW. |
| A3 | Buyer and seller each explicitly accept the current version (recorded via WhatsApp acceptance messages). | Both party-acceptance records exist for the current version hash. |
| A4 | Staff records contract acceptance. | State ACCEPTED; frozen proof = version hash + acceptance timestamp + messages + audit agree. |
| A5 | Staff issues the payment-instruction voucher. | State AWAITING_FUNDING_CONFIRMATION. Voucher shows configurable fields only; no beneficiary/account fixed before institution approval. |
| A6 | Buyer submits payment evidence (channel, sender, amount, reference, receipt). | Evidence status reads exactly `Payment Evidence Submitted`. State UNCHANGED; shipping NOT permitted. |
| A7 | Staff contacts the institution manually, records its response + deposit reference, with institution confirmation checked. | Coordination record exists with deposit reference + institution confirmation. |
| A8 | Staff confirms funding. | State FUNDED_CONFIRMED. (Without A7's reference + confirmation, this step must FAIL — see Scenario C.) |
| A9 | Staff records shipping confirmation. | State IN_FULFILMENT. |
| A10 | Staff records seller arrival at the delivery point. | State DELIVERED; readiness notification sent to buyer. |
| A11 | Staff records BUYER_ARRIVED_AT_HANDOVER, then HANDOVER_INSPECTION_COMPLETED. | Both events recorded; state stays DELIVERED. |
| A12 | Buyer explicitly chooses ACCEPT at handover. | State RECEIPT_CONFIRMED. |
| A13 | Staff prepares the settlement summary manually (deposit reference matches, amount, currency, beneficiary, delivery proof). | State SETTLEMENT_PENDING. |
| A14 | Staff records the institution settlement confirmation + settlement reference, by a staff member DIFFERENT from the funding confirmer. | Settlement confirmation recorded. Same-person attempt must FAIL (separation of duties). |
| A15 | Staff records settlement. | State SETTLED, then COMPLETED after full-cycle documentation check. |

## Scenario B — Rejection/dispute path end to end (CORE PROMPT §15 test 10)

| Step | Action | Expected result |
| --- | --- | --- |
| B1 | Walk a transaction to DELIVERED (steps A1–A10). | State DELIVERED. |
| B2 | Buyer explicitly REJECTS at handover with a reason. | State DISPUTED; dispute OPEN; NO refund happens automatically. |
| B3 | While DISPUTED, staff attempt settlement and closure. | Both attempts REJECTED with audit entries; state stays DISPUTED. |
| B4 | A staff member resolves the dispute as REFUND with resolution text. | Dispute RESOLVED, outcome REFUND. |
| B5 | Staff move the transaction to REFUND_PENDING. | State REFUND_PENDING. |
| B6 | Staff record refund execution with the institution settlement/refund reference, amount, currency, beneficiary, execution date, confirmation document — by a recorder different from the funding confirmer. | State REFUNDED. Without the reference, this step must FAIL. |
| B7 | Staff complete the transaction. | State COMPLETED via the refund route only. |

## Scenario C — Funding-gate path (CORE PROMPT §11.4)

| Step | Action | Expected result |
| --- | --- | --- |
| C1 | Transaction in AWAITING_FUNDING_CONFIRMATION with buyer evidence submitted but NO institution record. | Funding confirmation attempt FAILS; state unchanged. |
| C2 | Staff record a coordination entry WITHOUT a deposit reference (or without institution confirmation). | Funding confirmation attempt still FAILS. |
| C3 | Staff record a coordination entry WITH institution confirmation AND a deposit reference. | Funding confirmation SUCCEEDS → FUNDED_CONFIRMED. |
| C4 | Staff attempt to reuse the same deposit reference for a second transaction. | Rejected as a duplicate; surfaces for manual review; second transaction NOT funded. |

## Scenario D — Settlement path (CORE PROMPT §11.5)

| Step | Action | Expected result |
| --- | --- | --- |
| D1 | Transaction in RECEIPT_CONFIRMED. Staff prepare a settlement summary whose deposit reference does NOT match the coordination record. | Rejected; state unchanged. |
| D2 | Staff prepare a summary with a beneficiary changed from a WhatsApp message alone. | Rejected; discrepancy becomes a follow-up case, not a summary. |
| D3 | Correct summary prepared; settlement recorded only after institution confirmation + settlement reference, by a different staff member than the funder. | SETTLED, then COMPLETED. |

## Scenario E — Exception path (handover product-absent + amendment refusal)

| Step | Action | Expected result |
| --- | --- | --- |
| E1 | Transaction in DELIVERED; buyer arrives but the product is NOT there. Staff record the operational exception. | Exception recorded; state stays DELIVERED; accept/reject NOT available. |
| E2 | Staff attempt buyer acceptance while the exception is unresolved. | Rejected. |
| E3 | Staff resolve the exception and a real handover occurs (arrival + inspection events). | Explicit ACCEPT then works → RECEIPT_CONFIRMED. |
| E4 | On a FUNDED_CONFIRMED transaction, staff attempt a contract amendment. | Rejected with AMENDMENT_FORBIDDEN; version count unchanged; path offered is dispute or a later documented agreement. |
| E5 | On a DELIVERED transaction, staff wait and take no action. | NOTHING changes: no acceptance by silence, time, or any job. State stays DELIVERED. |

## Inbox triptych check (PB-13)

| Step | Action | Expected result |
| --- | --- | --- |
| I1 | Open the panel's Inbox tab on desktop. | List | chat | details all visible at once, full height. |
| I2 | Search, filter by tag/agent, and click triage chips. | List narrows to matching conversations only. |
| I3 | Open a chat: check ticks, dry-run labels, a template message, a media message, date separators. | Sent/delivered/read/failed ticks shown; dry-run rows labelled; template renders as a button; media renders as a media bubble; messages grouped under date separators. |
| I4 | Reply to a message, then add an internal note. | Quote appears above the composer; the note renders as a centred system notice marked "never sent" and creates NO outbound message. |
| I5 | On a phone-width view, open the inbox. | List → chat → drawer, one pane at a time, with back buttons. |

## Sign-off block (UNSIGNED — do not pre-fill)

- UAT session date: _______________
- Environment / build tested: _______________
- Scenarios passed: A ☐ B ☐ C ☐ D ☐ E ☐ I ☐
- Defects logged (ids): _______________
- Accepted by (Ahmed, signature): _______________
- Date of signature: _______________

Until the signature line above is filled by Ahmed himself, UAT is NOT
accepted, and no Sprint 4 acceptance gate is passed.
