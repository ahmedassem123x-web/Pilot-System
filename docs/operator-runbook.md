# Operator Runbook — Pilot System v3.1 (Sprint 4, PB-27)

Training material for operations staff. This runbook describes what
staff DO in the system. It does not change any rule: money stays with
the external financial institution, the system never moves money, and
no step here may be skipped, automated, or improvised.

Golden rules (repeat before every shift):

1. The panel RECORDS and REVIEWS only. It never executes a transfer, settlement, or refund.
2. Buyer evidence is NEVER funding confirmation. Only an institution confirmation + a Financial Institution Deposit Reference confirms funding.
3. A WhatsApp message is NEVER institution confirmation, NEVER a beneficiary change, and NEVER acceptance.
4. Acceptance is EXPLICIT ONLY: the buyer chooses ACCEPT or REJECT at the first actual handover, after actual inspection. Silence and elapsed time are never acceptance.
5. An open dispute FREEZES closure and settlement. Only a human resolves it.
6. The person who confirmed funding MUST NOT approve settlement or record the refund for the same transaction.

## 1. Daily operations

- Start of day: log in (staff account, JWT session). Check the Inbox triptych: triage `attention` first (failed messages, open disputes), then `open`.
- Triage: assign each conversation to one agent, tag it (e.g. funding-question, handover, dispute), and add internal notes for anything a colleague must know. Internal notes are centred system notices in the chat — they are never sent to customers.
- End of day: confirm every conversation touched today has an owner (assigned agent) and a triage state; nothing stays unassigned overnight.
- Never use the panel to contact a customer outside WhatsApp: the ONLY customer interface is WhatsApp Business Platform.

## 2. Verification path (manual, staff only, in this order)

1. Review the buyer's payment evidence: channel, sender name, beneficiary name as shown, amount, currency, external payment reference, receipt.
2. Contact the financial institution MANUALLY (phone, branch, or the channel the institution accepts — the system sends nothing to the institution).
3. Send the institution ONLY the information it accepts receiving.
4. Request verification of the transfer/remittance.
5. Record the institution's response in the coordination record, with its reference. If the institution confirms a deposit, record the Financial Institution Deposit Reference.
6. Only now may funding be confirmed (both: institution confirmation AND deposit reference). If either is missing, STOP — the Guard will reject the confirmation, and that rejection is correct behaviour, not an error to work around.
7. Duplicate deposit reference: if the system reports a duplicate, STOP and escalate for manual review. Never reuse, edit, or delete a reference to force it through.

## 3. Settlement

1. After buyer acceptance (RECEIPT_CONFIRMED), prepare the settlement summary MANUALLY: deposit reference (must match the coordination record), amount, currency, beneficiary name, delivery proof or dispute outcome.
2. If any field disagrees with the coordination record — especially the beneficiary — STOP: that is a follow-up case until the institution completes its approved verification. Never change a beneficiary from a WhatsApp message.
3. Send the summary to the institution MANUALLY (outside the system).
4. When the institution confirms execution, record the outcome: settlement reference, execution date, confirmation document/notice, and the staff member recording it. The recorder must differ from the funding confirmer.
5. Only then record settlement in the system (SETTLED), then complete the transaction (COMPLETED) once the full cycle is documented.

## 4. Refunds

1. A refund starts ONLY from a human dispute resolution with outcome REFUND (DISPUTED → REFUND_PENDING).
2. Record refund execution ONLY after institution confirmation, with: settlement/refund reference, executed amount + currency, final beneficiary + receiving method if any, execution date, confirmation document, recording staff member (different from the funding confirmer).
3. Without the institution reference, the refund step FAILS by design. A rejected settlement attempt while DISPUTED does not block a later legitimate refund (Sprint 4 Guard fix — see the Sprint 4 report), but a real executed settlement does: after SETTLED there is no refund path.

## 5. Disputes

1. Open a dispute with a reason + evidence. From that moment closure and settlement are frozen.
2. Investigate outside the system; keep notes as internal notes (never sent).
3. Resolve as a human: PROCEED (return to the pre-dispute state only), REFUND, or CANCELLED — with resolution text, resolver, and timestamp. Resolution selects the next step; it never executes money.
4. Never resolve a dispute by editing data, deleting rows, or asking for a system override. There is no override.

## 6. Handover (Sold as Seen — exact sequence, no skipping)

1. Seller confirms the product arrived at the agreed delivery point → DELIVERED; readiness notification goes to the buyer.
2. Record BUYER_ARRIVED_AT_HANDOVER when the buyer actually arrives.
3. If the buyer arrives and the product is NOT there: record the operational exception, notify operations staff, and do NOT treat the product as received or accepted. State stays DELIVERED. Accept/reject stay unavailable until staff resolve the exception AND a real handover occurs.
4. Record HANDOVER_INSPECTION_COMPLETED after inspection.
5. Buyer EXPLICITLY chooses ACCEPT or REJECT. ACCEPT → RECEIPT_CONFIRMED. REJECT → DISPUTED with a reason.
6. There is no inspection window (no 24/48/72 hours), no acceptance by silence, and no job that accepts for the buyer. If the buyer does not respond, send a human reminder or escalate to a human — never an automatic acceptance.

## 7. WhatsApp inbox (triptych)

- List | chat | details on desktop; list → chat → drawer on phones.
- Search by conversation, transaction, or message text; filter by channel, tag, agent; triage chips: open / attention / resolved.
- Message ticks: sending… / ✓ sent / ✓✓ delivered / ✓✓ read / failed. A `dry-run` label means the message was NOT delivered — never quote it to a customer as sent.
- Templates: a locally-approved but Meta-rejected template is UN-SENDABLE and its rejection reason is shown. Do not rename it, retype it as free text outside the window, or otherwise bypass the block — escalate to whoever owns templates.
- 24-hour window: free text inside the window only; approved Utility templates only outside it. If unsure whether you are inside the window, use an approved template.
- Buttons (≤3) and lists (≤10) trigger on their id, never on their title text.

## 8. Backup and restore

- Daily encrypted backup (see docs/backup-restore-runbook.md): database dump + object-storage copy, encrypted, copied off-host, checksum-verified, logged. A backup without a log entry counts as not taken.
- Restore is NEVER run over the live database in place: restore to a SEPARATE target, verify counts (transactions, audit rows, evidence statuses, deposit-reference uniqueness) and one full transaction read, then record a written restore record before any promotion.
- Snapshot export/import in the panel is the TEST-DOUBLE procedure only. Production restore uses database dumps (runbook §4) and is UNVERIFIED until a real restore record exists — say so if asked.

## 9. Incident escalation

| Situation | Do first | Escalate to |
| --- | --- | --- |
| Duplicate deposit reference | Stop; do not fund either transaction | Operations lead, for manual review with the institution |
| Beneficiary mismatch | Stop; open a follow-up case | Operations lead + institution verification |
| Webhook signature rejections spike | Check nothing changed in app secret/config; do not disable verification | Technical owner (never disable HMAC to "fix" it) |
| Template rejected by Meta | Leave it un-sendable; use an approved template | Template owner / Meta account owner |
| Backup job fails | Retry once from a clean state the same day | Technical owner if the retry fails — never silently skip a day |
| Suspected data tampering / audit anomaly | Stop work on that transaction; preserve everything | Ahmed + technical owner immediately |
| Any request to move money, override an institution outcome, impose acceptance, or amend after shipping | Refuse: the system has no such action, by design | Ahmed (as a scope-change request, in writing, if it is ever pursued) |

## 10. Handover of the system itself (delivery)

- Hosting, domain, and external-service accounts must be in the CLIENT'S name wherever the provider allows.
- Meta account, WABA, and number: client-owned; ORTECH staff permissions are RETURNED/HANDED OVER at delivery.
- Access data handed over: repository access, environment variable NAMES, and account ownership — never secret values in chat, email, or documents.
- Until a written agreement with the financial institution exists, NO real financial operation starts. Test data and configurable procedures only.
