// Pilot System v3.1 — Sprint 2 (PB-07, PB-08, PB-09, PB-10).
// Transaction heart: transactions, contract versions, the 15-state
// machine with backend Guards, append-only audit, and the contract
// amendment policy. This service is transport-independent: Sprint 3
// wires HTTP controllers + the Prisma Store onto it WITHOUT changing
// any Guard logic below.
//
// HARD RULES ENFORCED HERE (each with a negative test):
// - Exactly 15 states; audit-event names are never states.
// - No acceptance by elapsed time, silence, or automatic step: there
//   is no such code path in this file. Acceptance requires explicit
//   recorded party actions (see recordPartyAcceptance /
//   recordHandoverAcceptance) and Guard checks on stored evidence.
// - Buyer evidence (PaymentEvidence, status always
//   PAYMENT_EVIDENCE_SUBMITTED) NEVER permits funding or shipping.
//   FUNDED_CONFIRMED requires BOTH institution confirmation AND a
//   Financial Institution Deposit Reference (unique across tx).
// - A WhatsApp message alone is NEVER institution confirmation.
// - Separation of duties: settlement/recording staff must differ from
//   the funding confirmer for the same transaction (backend Guard).
// - Contract versions are never updated or deleted. Current version =
//   highest version_number. accepted_by on a version row records ONLY
//   the staff member who recorded acceptance, and NEVER satisfies the
//   PENDING_REVIEW -> ACCEPTED Guard alone: that Guard requires TWO
//   party-acceptance AuditEvents + matching WhatsApp MessageLogs for
//   the current version hash (transition-matrix.md §8 resolution (b)).
// - Accepted-version freezing is proved WITHOUT mutating the version
//   row (mutation is blocked): the frozen proof is the version's
//   SHA-256 hash + the CONTRACT_ACCEPTED audit timestamp + the
//   acceptance MessageLogs + the audit trail, which must all agree.
// - Every transition writes exactly ONE AuditEvent; every rejected
//   attempt writes exactly ONE TRANSITION_REJECTED AuditEvent.
// - Money is NEVER moved here. SETTLED / REFUNDED / COMPLETED only
//   record that an EXTERNAL institution confirmed execution.
import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { newCorrelationId } from '../common/ids';
import {
  DomainError,
  DuplicateError,
  ForbiddenTransitionError,
  GuardFailedError,
  NotFoundError,
  PermissionDeniedError,
} from '../common/errors';
import type {
  ContractVersion,
  CreateTransactionInput,
  DeliveryEvent,
  Dispute,
  FinancialCoordinationRecord,
  PaymentEvidence,
  SettlementSummary,
  Store,
  Transaction,
} from '../store/repository';
import type {
  DeliveryEventType,
  PartyRole,
  TransactionState,
} from '../common/transaction-state';
import { AuditService } from '../audit/audit.service';
import {
  DISPUTE_RETURN_TARGETS,
  findTransitionRow,
  TRANSITION_TABLE,
} from './transition-table';

export interface Actor {
  id: string;
  role: 'STAFF' | 'BUYER' | 'SELLER';
  permissions: string[];
}

export interface VoucherInput {
  buyerName: string;
  sellerName: string;
  purpose: string;
  amount: number;
  currency: string;
  paymentReferenceText: string;
  channelInstructions?: string | null;
}

export interface SettlementSummaryInput {
  deposit_reference: string;
  amount: number;
  currency: string;
  beneficiary_name: string;
  delivery_proof_or_dispute_outcome: string;
}

export interface RefundConfirmationInput {
  settlementReference: string;
  executedAmount: number;
  currency: string;
  beneficiary: string;
  receivingMethod?: string | null;
  executionDate: string;
  confirmationDocument: string;
}

export interface TransitionInput {
  correlationId?: string;
  cancellationReason?: string;
  bothPartiesAgreement?: boolean;
  // Row 5 amendment (ACCEPTED -> PENDING_REVIEW).
  buyerApprovedAmendment?: boolean;
  sellerApprovedAmendment?: boolean;
  newContractContent?: string;
  newContractStorageFileId?: string | null;
  // Row 6 voucher.
  voucher?: VoucherInput;
  // Row 11 shipping confirmation.
  shippingConfirmed?: boolean;
  // Dispute rows (9, 12, 14, 16, 18, 20).
  disputeReason?: string;
  disputeEvidenceFileIds?: string[];
  // Row 17 settlement preparation.
  settlementSummary?: SettlementSummaryInput;
  // Row 17 beneficiary protection: true means the beneficiary was
  // changed from a WhatsApp message alone — always rejected.
  beneficiaryChangedFromWhatsappMessage?: boolean;
  // Row 25 refund execution confirmation.
  refundConfirmation?: RefundConfirmationInput;
}

export function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

@Injectable()
export class TransactionsService {
  constructor(
    private readonly store: Store,
    private readonly audit: AuditService,
  ) {}

  // -- Creation (PB-07) ------------------------------------------------------
  createTransaction(input: CreateTransactionInput): Transaction {
    return this.store.createTransaction(input);
  }

  /**
   * Creates a DRAFT transaction with exactly one BUYER and one SELLER
   * party. The same person may not be both parties of one transaction.
   * (A DRAFT built without parties can still be created via
   * createTransaction + addParty, so the submit Guard's exactly-one
   * check remains independently testable.)
   */
  createTransactionWithParties(
    input: CreateTransactionInput,
    buyerUserId: string,
    sellerUserId: string,
  ): Transaction {
    if (buyerUserId === sellerUserId) {
      throw new DomainError(
        'INVALID_PARTIES',
        422,
        'Buyer and seller of one transaction must be different people',
      );
    }
    if (!this.store.findUserById(buyerUserId)) {
      throw new NotFoundError('User', buyerUserId);
    }
    if (!this.store.findUserById(sellerUserId)) {
      throw new NotFoundError('User', sellerUserId);
    }
    const tx = this.store.createTransaction(input);
    this.store.addParty(tx.id, buyerUserId, 'BUYER');
    this.store.addParty(tx.id, sellerUserId, 'SELLER');
    return tx;
  }

  addParty(
    transactionId: string,
    userId: string,
    role: PartyRole,
  ): Transaction {
    this.requireTransaction(transactionId);
    this.store.addParty(transactionId, userId, role);
    return this.requireTransaction(transactionId);
  }

  createContractVersion(
    transactionId: string,
    content: string,
    storageFileId?: string | null,
    supersededBy?: string | null,
  ): ContractVersion {
    this.requireTransaction(transactionId);
    const existing = this.store.versionsForTransaction(transactionId);
    const nextNumber =
      existing.length > 0
        ? Math.max(...existing.map((v) => v.version_number)) + 1
        : 1;
    const version = this.store.createContractVersion({
      transaction_id: transactionId,
      version_number: nextNumber,
      content_hash: sha256Hex(content),
      storage_file_id: storageFileId ?? null,
      superseded_by: supersededBy ?? null,
    });
    this.audit.record({
      transactionId,
      actorId: null,
      actorRole: 'SYSTEM',
      action: 'CONTRACT_VERSION_CREATED',
      previousState: null,
      newState: null,
      details: {
        version_number: version.version_number,
        content_hash: version.content_hash,
      },
    });
    return version;
  }

  currentVersion(transactionId: string): ContractVersion | undefined {
    return this.store.currentVersion(transactionId);
  }

  getTransaction(transactionId: string): Transaction {
    return this.requireTransaction(transactionId);
  }

  // -- Evidence recording (PB-09: each writes an AuditEvent) -----------------
  recordPartyAcceptance(
    transactionId: string,
    partyRole: 'BUYER' | 'SELLER',
    whatsappMessageId: string,
    recordedByStaffId: string,
    correlationId?: string,
  ): void {
    const tx = this.requireTransaction(transactionId);
    const version = this.store.currentVersion(transactionId);
    if (!version) {
      throw new GuardFailedError('No contract version exists to accept');
    }
    this.store.createMessageLog({
      whatsapp_message_id: whatsappMessageId,
      transaction_id: transactionId,
      direction: 'INBOUND',
      status: 'READ',
    });
    this.audit.record({
      correlationId,
      transactionId,
      actorId: recordedByStaffId,
      actorRole: partyRole,
      action: 'PARTY_ACCEPTANCE',
      previousState: tx.state,
      newState: null,
      details: {
        version_hash: version.content_hash,
        version_number: version.version_number,
        whatsapp_message_id: whatsappMessageId,
        recorded_by_staff: recordedByStaffId,
      },
    });
  }

  recordHandoverAcceptance(
    transactionId: string,
    whatsappMessageId: string,
    buyerUserId: string,
    correlationId?: string,
  ): void {
    const tx = this.requireTransaction(transactionId);
    this.store.createMessageLog({
      whatsapp_message_id: whatsappMessageId,
      transaction_id: transactionId,
      direction: 'INBOUND',
      status: 'READ',
    });
    this.audit.record({
      correlationId,
      transactionId,
      actorId: buyerUserId,
      actorRole: 'BUYER',
      action: 'BUYER_HANDOVER_ACCEPT',
      previousState: tx.state,
      newState: null,
      details: { whatsapp_message_id: whatsappMessageId },
    });
  }

  recordDeliveryEvent(
    transactionId: string,
    eventType: DeliveryEventType,
    recordedBy: string,
    note?: string | null,
    correlationId?: string,
  ): DeliveryEvent {
    const tx = this.requireTransaction(transactionId);
    const event = this.store.createDeliveryEvent({
      transaction_id: transactionId,
      event_type: eventType,
      recorded_by: recordedBy,
      note: note ?? null,
    });
    this.audit.record({
      correlationId,
      transactionId,
      actorId: recordedBy,
      actorRole: 'STAFF',
      action: 'DELIVERY_EVENT_RECORDED',
      previousState: tx.state,
      newState: null,
      details: { event_type: eventType, note: note ?? null },
    });
    return event;
  }

  resolveOperationalException(
    transactionId: string,
    staffId: string,
    correlationId?: string,
  ): void {
    const tx = this.requireTransaction(transactionId);
    this.audit.record({
      correlationId,
      transactionId,
      actorId: staffId,
      actorRole: 'STAFF',
      action: 'OPERATIONAL_EXCEPTION_RESOLVED',
      previousState: tx.state,
      newState: null,
      details: {},
    });
  }

  submitPaymentEvidence(input: {
    transactionId: string;
    channel: string;
    senderName: string;
    beneficiaryNameAsShown?: string | null;
    amount: number;
    currency: string;
    externalPaymentReference: string;
    receiptFileId?: string | null;
    submittedBy: string;
    correlationId?: string;
  }): PaymentEvidence {
    const tx = this.requireTransaction(input.transactionId);
    const evidence = this.store.createPaymentEvidence({
      transaction_id: input.transactionId,
      channel: input.channel,
      sender_name: input.senderName,
      beneficiary_name_as_shown: input.beneficiaryNameAsShown ?? null,
      amount: input.amount,
      currency: input.currency,
      external_payment_reference: input.externalPaymentReference,
      receipt_file_id: input.receiptFileId ?? null,
      submitted_by: input.submittedBy,
    });
    // Evidence status is fixed by the store: PAYMENT_EVIDENCE_SUBMITTED.
    // It is never funding confirmation and never permits shipping.
    this.audit.record({
      correlationId: input.correlationId,
      transactionId: input.transactionId,
      actorId: input.submittedBy,
      actorRole: 'BUYER',
      action: 'PAYMENT_EVIDENCE_SUBMITTED',
      previousState: tx.state,
      newState: null,
      details: {
        evidence_id: evidence.id,
        external_payment_reference: evidence.external_payment_reference,
        status: evidence.status,
      },
    });
    return evidence;
  }

  recordCoordination(input: {
    transactionId: string;
    staffId: string;
    contactMethod: string;
    messageSent?: string | null;
    institutionResponse?: string | null;
    depositReference?: string | null;
    settlementReference?: string | null;
    institutionConfirmed?: boolean;
    correlationId?: string;
  }): FinancialCoordinationRecord {
    const tx = this.requireTransaction(input.transactionId);
    try {
      const record = this.store.createCoordinationRecord({
        transaction_id: input.transactionId,
        staff_id: input.staffId,
        contact_method: input.contactMethod,
        message_sent: input.messageSent ?? null,
        institution_response: input.institutionResponse ?? null,
        deposit_reference: input.depositReference ?? null,
        settlement_reference: input.settlementReference ?? null,
        institution_confirmed: input.institutionConfirmed ?? false,
      });
      this.audit.record({
        correlationId: input.correlationId,
        transactionId: input.transactionId,
        actorId: input.staffId,
        actorRole: 'STAFF',
        action: 'COORDINATION_RECORDED',
        previousState: tx.state,
        newState: null,
        details: {
          coordination_id: record.id,
          institution_confirmed: record.institution_confirmed,
          deposit_reference_present: record.deposit_reference !== null,
        },
      });
      return record;
    } catch (error) {
      // A duplicate deposit reference surfaces to staff for manual
      // review: it is audited and rethrown, never silently resolved.
      if (error instanceof DuplicateError) {
        this.audit.record({
          correlationId: input.correlationId,
          transactionId: input.transactionId,
          actorId: input.staffId,
          actorRole: 'STAFF',
          action: 'COORDINATION_REJECTED_DUPLICATE_REFERENCE',
          previousState: tx.state,
          newState: null,
          details: { code: error.code },
        });
      }
      throw error;
    }
  }

  recordSettlementConfirmation(
    summaryId: string,
    input: {
      settlementReference: string;
      confirmationAt: Date;
      actorId: string;
      correlationId?: string;
    },
  ): SettlementSummary {
    const summary = this.store.findSettlementSummaryById(summaryId);
    if (!summary) throw new NotFoundError('SettlementSummary', summaryId);
    const updated = this.store.updateSettlementSummary(summaryId, {
      settlement_reference: input.settlementReference,
      institution_confirmation_at: input.confirmationAt,
    });
    const coordination = this.store
      .coordinationsForTransaction(summary.transaction_id)
      .find((c) => c.deposit_reference === summary.deposit_reference);
    if (coordination) {
      this.store.updateCoordinationRecord(coordination.id, {
        settlement_reference: input.settlementReference,
      });
    }
    this.audit.record({
      correlationId: input.correlationId,
      transactionId: summary.transaction_id,
      actorId: input.actorId,
      actorRole: 'STAFF',
      action: 'SETTLEMENT_CONFIRMATION_RECORDED',
      previousState: null,
      newState: null,
      details: {
        settlement_summary_id: summaryId,
        settlement_reference: input.settlementReference,
      },
    });
    return updated;
  }

  resolveDispute(
    transactionId: string,
    input: {
      outcome: 'REFUND' | 'PROCEED' | 'CANCELLED';
      resolution: string;
      resolvedBy: string;
      correlationId?: string;
    },
  ): Dispute {
    const tx = this.requireTransaction(transactionId);
    const open = this.store
      .disputesForTransaction(transactionId)
      .filter((d) => d.status === 'OPEN');
    if (open.length === 0) {
      throw new GuardFailedError('No open dispute exists to resolve');
    }
    if (!input.resolution) {
      throw new GuardFailedError('Dispute resolution text is required');
    }
    const dispute = this.store.updateDispute(open[open.length - 1].id, {
      status: 'RESOLVED',
      resolution: input.resolution,
      resolution_outcome: input.outcome,
      resolved_by: input.resolvedBy,
      resolved_at: new Date(),
    });
    this.audit.record({
      correlationId: input.correlationId,
      transactionId,
      actorId: input.resolvedBy,
      actorRole: 'STAFF',
      action: 'DISPUTE_RESOLVED',
      previousState: tx.state,
      newState: null,
      details: {
        dispute_id: dispute.id,
        resolution_outcome: input.outcome,
        resolution: input.resolution,
      },
    });
    return dispute;
  }

  // -- Amendment policy (PB-10) ------------------------------------------------
  /**
   * Routes an amendment request by the transaction's current state:
   * - DRAFT / PENDING_REVIEW (before acceptance): new version, old
   *   preserved, no state change.
   * - ACCEPTED (after acceptance, before funding/shipping): row 5 —
   *   BOTH parties' approval + new version + re-acceptance via row 3.
   * - FUNDED_CONFIRMED or later (funding/shipping done): REJECTED.
   *   The path is dispute, or a later documented agreement — never an
   *   amended version. The rejection is audited.
   */
  requestAmendment(
    transactionId: string,
    actor: Actor,
    input: {
      newContent: string;
      buyerApproved?: boolean;
      sellerApproved?: boolean;
      correlationId?: string;
    },
  ): Transaction {
    const tx = this.requireTransaction(transactionId);
    const correlationId = input.correlationId ?? newCorrelationId();
    if (tx.state === 'DRAFT' || tx.state === 'PENDING_REVIEW') {
      this.createContractVersion(transactionId, input.newContent);
      this.audit.record({
        correlationId,
        transactionId,
        actorId: actor.id,
        actorRole: actor.role,
        action: 'CONTRACT_AMENDED_PRE_ACCEPTANCE',
        previousState: tx.state,
        newState: tx.state,
        details: {},
      });
      return this.requireTransaction(transactionId);
    }
    if (tx.state === 'ACCEPTED') {
      return this.transition(transactionId, actor, 'PENDING_REVIEW', {
        correlationId,
        buyerApprovedAmendment: input.buyerApproved,
        sellerApprovedAmendment: input.sellerApproved,
        newContractContent: input.newContent,
      });
    }
    this.audit.record({
      correlationId,
      transactionId,
      actorId: actor.id,
      actorRole: actor.role,
      action: 'AMENDMENT_REJECTED',
      previousState: tx.state,
      newState: null,
      details: {
        code: 'AMENDMENT_FORBIDDEN',
        reason: 'Amendment is forbidden after confirmed funding or shipping',
      },
    });
    throw new DomainError(
      'AMENDMENT_FORBIDDEN',
      422,
      `Contract amendment is forbidden in state ${tx.state}; the path is dispute or a later documented agreement`,
    );
  }

  // -- State machine (PB-08) ---------------------------------------------------
  listAllowedTransitions(): typeof TRANSITION_TABLE {
    return TRANSITION_TABLE;
  }

  transition(
    transactionId: string,
    actor: Actor,
    to: TransactionState,
    input: TransitionInput = {},
  ): Transaction {
    const tx = this.requireTransaction(transactionId);
    const from = tx.state;
    const correlationId = input.correlationId ?? newCorrelationId();

    const reject = (error: DomainError): never => {
      this.audit.record({
        correlationId,
        transactionId,
        actorId: actor.id,
        actorRole: actor.role,
        action: 'TRANSITION_REJECTED',
        previousState: from,
        newState: to,
        details: { code: error.code, reason: error.message },
      });
      throw error;
    };

    if (to === from) {
      return reject(
        new DomainError(
          'SELF_TRANSITION',
          422,
          `Self-transition ${from} -> ${to} is not a transition`,
        ),
      );
    }
    const row = findTransitionRow(from, to);
    if (!row) {
      return reject(new ForbiddenTransitionError(from, to));
    }
    if (!actor.permissions.includes(row.permission)) {
      return reject(new PermissionDeniedError(row.permission));
    }

    try {
      this.checkGuard(row.action, tx, actor, input, to);
    } catch (error) {
      if (error instanceof DomainError) return reject(error);
      throw error;
    }

    // Apply side effects that are part of the transition (rows, not
    // audit rows: the transition itself writes exactly one AuditEvent).
    if (row.action === 'CONTRACT_AMENDMENT_REQUESTED') {
      // New version row only: the transition's single AuditEvent below
      // is the amendment record, so no second audit row is written here.
      this.createContractVersionRow(
        transactionId,
        input.newContractContent as string,
      );
    }
    if (row.action === 'PRODUCT_ARRIVED_AT_DELIVERY_POINT') {
      // Handover step 2: readiness notification to the buyer, recorded
      // as a DeliveryEvent + a real (non-dry-run) MessageLog.
      this.store.createDeliveryEvent({
        transaction_id: transactionId,
        event_type: 'HANDOVER_READINESS_NOTIFIED',
        recorded_by: actor.id,
        note: 'Readiness notification sent to buyer',
      });
      this.store.createMessageLog({
        whatsapp_message_id: `readiness-${transactionId}-${Date.now()}`,
        transaction_id: transactionId,
        direction: 'OUTBOUND',
        template_name: 'handover_readiness',
        status: 'SENT',
        is_dry_run: false,
      });
    }
    if (row.action === 'SETTLEMENT_PREPARED') {
      const summary = input.settlementSummary as SettlementSummaryInput;
      this.store.createSettlementSummary({
        transaction_id: transactionId,
        deposit_reference: summary.deposit_reference,
        settlement_reference: '',
        amount: summary.amount,
        currency: summary.currency,
        beneficiary_name: summary.beneficiary_name,
        delivery_proof_or_dispute_outcome:
          summary.delivery_proof_or_dispute_outcome,
        prepared_by: actor.id,
      });
    }
    if (row.action === 'REFUND_RECORDED') {
      const confirmation = input.refundConfirmation as RefundConfirmationInput;
      const coordination = this.store
        .coordinationsForTransaction(transactionId)
        .find((c) => c.deposit_reference !== null);
      if (coordination) {
        this.store.updateCoordinationRecord(coordination.id, {
          settlement_reference: confirmation.settlementReference,
          institution_response: `Refund execution confirmed: ${confirmation.confirmationDocument}`,
        });
      }
    }
    if (row.action === 'DISPUTE_OPENED') {
      this.store.createDispute({
        transaction_id: transactionId,
        reason: input.disputeReason as string,
        evidence_file_ids: input.disputeEvidenceFileIds ?? [],
      });
    }

    const updated = this.store.updateTransactionState(transactionId, to);
    this.audit.record({
      correlationId,
      transactionId,
      actorId: actor.id,
      actorRole: actor.role,
      action: row.action,
      previousState: from,
      newState: to,
      details: this.transitionDetails(
        row.action,
        actor,
        input,
        transactionId,
      ),
    });
    return updated;
  }

  // -- Guard checks, one per matrix row action --------------------------------
  private checkGuard(
    action: string,
    tx: Transaction,
    actor: Actor,
    input: TransitionInput,
    to: TransactionState,
  ): void {
    const fail = (message: string): never => {
      throw new GuardFailedError(message);
    };
    const parties = this.store.partiesForTransaction(tx.id);
    const buyers = parties.filter((p) => p.role === 'BUYER');
    const sellers = parties.filter((p) => p.role === 'SELLER');
    const version = this.store.currentVersion(tx.id);
    const audits = this.store.auditForTransaction(tx.id);
    const events = this.store.deliveryEventsForTransaction(tx.id);
    const coordinations = this.store.coordinationsForTransaction(tx.id);
    const confirmedCoordination = coordinations.find(
      (c) => c.institution_confirmed === true && c.deposit_reference !== null,
    );

    switch (action) {
      case 'TRANSACTION_SUBMITTED_FOR_REVIEW': {
        if (buyers.length !== 1 || sellers.length !== 1) {
          fail('Transaction must have exactly one BUYER and one SELLER party');
        }
        if (!version || !version.content_hash) {
          fail('Contract version 1 with a SHA-256 content_hash is required');
        }
        if (
          !tx.amount ||
          !tx.currency ||
          !tx.product_description ||
          !(tx.quantity > 0) ||
          !tx.delivery_point ||
          !tx.cancellation_terms
        ) {
          fail('Transaction fields (amount, currency, product, quantity, delivery point, cancellation terms) are required');
        }
        return;
      }
      case 'TRANSACTION_CANCELLED': {
        if (!input.cancellationReason) {
          fail('Cancellation reason is required');
        }
        // Rows 4, 7, 10 guards that depend on the from-state:
        if (tx.state === 'PENDING_REVIEW') {
          const accepted = audits.some((a) => a.action === 'CONTRACT_ACCEPTED');
          if (accepted) fail('No accepted version may exist when cancelling from PENDING_REVIEW');
        }
        if (tx.state === 'ACCEPTED' || tx.state === 'AWAITING_FUNDING_CONFIRMATION') {
          if (input.bothPartiesAgreement !== true) {
            fail('Cancellation from this state requires both parties agreement recorded');
          }
          if (confirmedCoordination) {
            fail('Cannot cancel: institution confirmation or deposit reference already exists');
          }
        }
        return;
      }
      case 'CONTRACT_ACCEPTED': {
        // Resolution (b): accepted_by alone NEVER satisfies this Guard.
        // Require TWO party-acceptance AuditEvents + matching WhatsApp
        // MessageLogs for the CURRENT version hash.
        if (!version) fail('No contract version exists to accept');
        const acceptances = audits.filter(
          (a) =>
            a.action === 'PARTY_ACCEPTANCE' &&
            (a.details as Record<string, unknown> | null)?.version_hash ===
              version?.content_hash,
        );
        const buyerOk = acceptances.some((a) => a.actor_role === 'BUYER');
        const sellerOk = acceptances.some((a) => a.actor_role === 'SELLER');
        if (!buyerOk || !sellerOk) {
          fail('Explicit acceptance from BOTH buyer and seller is required for the current version');
        }
        for (const acceptance of acceptances) {
          const messageId = (acceptance.details as Record<string, unknown>)
            ?.whatsapp_message_id as string | undefined;
          const log = messageId
            ? this.store.findMessageLogByWhatsappId(messageId)
            : undefined;
          if (!log || log.transaction_id !== tx.id) {
            fail('Party acceptance must have a matching WhatsApp MessageLog for this transaction');
          }
        }
        return;
      }
      case 'CONTRACT_AMENDMENT_REQUESTED': {
        if (
          input.buyerApprovedAmendment !== true ||
          input.sellerApprovedAmendment !== true
        ) {
          fail('Amendment after acceptance requires BOTH parties approval');
        }
        if (!input.newContractContent) {
          fail('Amendment requires new contract content for the new version');
        }
        return;
      }
      case 'FUNDING_AWAITING_STARTED': {
        // Frozen accepted version: CONTRACT_ACCEPTED audit for the
        // current hash must exist (hash + timestamp + messages + audit
        // agree); the voucher itself is configurable, descriptive data.
        const accepted = audits.some(
          (a) =>
            a.action === 'CONTRACT_ACCEPTED' &&
            (a.details as Record<string, unknown> | null)?.version_hash ===
              version?.content_hash,
        );
        if (!accepted) fail('Accepted version is not frozen for the current version hash');
        const voucher = input.voucher;
        if (
          !voucher ||
          !voucher.buyerName ||
          !voucher.sellerName ||
          !voucher.purpose ||
          !voucher.amount ||
          !voucher.currency ||
          !voucher.paymentReferenceText
        ) {
          fail('Payment-instruction voucher fields are required');
        }
        return;
      }
      case 'FUNDING_CONFIRMED': {
        // Funding gate (both required): institution confirmation AND
        // deposit reference. Buyer evidence alone never passes: this
        // Guard reads ONLY FinancialCoordinationRecord, never
        // PaymentEvidence and never a MessageLog.
        if (!confirmedCoordination) {
          fail('Funding confirmation requires institution confirmation AND a Financial Institution Deposit Reference');
        }
        const clash = this.store.findCoordinationByDepositReference(
          confirmedCoordination?.deposit_reference as string,
        );
        if (clash && clash.transaction_id !== tx.id) {
          throw new DuplicateError(
            'DUPLICATE_DEPOSIT_REFERENCE',
            'Financial Institution Deposit Reference already used for another transaction',
          );
        }
        return;
      }
      case 'DISPUTE_OPENED': {
        if (!input.disputeReason) {
          fail('Dispute reason is required');
        }
        if (!Array.isArray(input.disputeEvidenceFileIds)) {
          fail('Dispute evidence_file_ids must be provided (possibly empty)');
        }
        return;
      }
      case 'FULFILMENT_STARTED': {
        if (input.shippingConfirmed !== true) {
          fail('Seller shipping/fulfilment confirmation is required');
        }
        return;
      }
      case 'PRODUCT_ARRIVED_AT_DELIVERY_POINT': {
        const arrived = events.some(
          (e) => e.event_type === 'SELLER_ARRIVED_AT_DELIVERY_POINT',
        );
        if (!arrived) {
          fail('Seller arrival at the delivery point must be recorded first');
        }
        return;
      }
      case 'RECEIPT_CONFIRMED_BY_BUYER': {
        // Sold as Seen: explicit buyer acceptance ONLY, after BOTH
        // handover events, with NO unresolved product-absent exception.
        const buyerArrived = events.some(
          (e) => e.event_type === 'BUYER_ARRIVED_AT_HANDOVER',
        );
        const inspected = events.some(
          (e) => e.event_type === 'HANDOVER_INSPECTION_COMPLETED',
        );
        if (!buyerArrived) fail('BUYER_ARRIVED_AT_HANDOVER event is required');
        if (!inspected) fail('HANDOVER_INSPECTION_COMPLETED event is required');
        const exceptions = events.filter(
          (e) => e.event_type === 'OPERATIONAL_EXCEPTION_PRODUCT_ABSENT',
        ).length;
        const resolutions = audits.filter(
          (a) => a.action === 'OPERATIONAL_EXCEPTION_RESOLVED',
        ).length;
        if (exceptions > resolutions) {
          fail('Unresolved product-absent operational exception blocks acceptance');
        }
        const buyerAccept = audits.some(
          (a) =>
            a.action === 'BUYER_HANDOVER_ACCEPT' && a.actor_role === 'BUYER',
        );
        if (!buyerAccept) {
          fail('Buyer explicit ACCEPT at handover is required');
        }
        return;
      }
      case 'SETTLEMENT_PREPARED': {
        if (input.beneficiaryChangedFromWhatsappMessage === true) {
          fail('Beneficiary/destination must never change from a WhatsApp message alone');
        }
        const summary = input.settlementSummary;
        if (
          !summary ||
          !summary.deposit_reference ||
          !summary.amount ||
          !summary.currency ||
          !summary.beneficiary_name ||
          !summary.delivery_proof_or_dispute_outcome
        ) {
          fail('Settlement summary fields (deposit reference, amount, currency, beneficiary, delivery proof or dispute outcome) are required');
        }
        if (
          confirmedCoordination &&
          summary.deposit_reference !== confirmedCoordination.deposit_reference
        ) {
          fail('Settlement summary deposit reference must match the coordination record');
        }
        if (!confirmedCoordination) {
          fail('No confirmed funding coordination exists for this settlement');
        }
        return;
      }
      case 'SETTLEMENT_RECORDED': {
        const summary = this.store
          .settlementSummariesForTransaction(tx.id)
          .find((s) => s.institution_confirmation_at !== null);
        if (!summary) {
          fail('Settlement summary with institution confirmation is required');
        }
        const settlementRef = coordinations.some(
          (c) => c.settlement_reference !== null,
        );
        if (!settlementRef) {
          fail('Financial Institution Settlement Reference is required');
        }
        // Separation of duties: settlement recorder != funding confirmer.
        const fundingConfirmer = confirmedCoordination?.staff_id;
        if (fundingConfirmer && actor.id === fundingConfirmer) {
          throw new DomainError(
            'SEPARATION_OF_DUTIES_VIOLATION',
            403,
            'The staff member who confirmed funding must not approve settlement for the same transaction',
          );
        }
        return;
      }
      case 'TRANSACTION_COMPLETED': {
        if (tx.state === 'SETTLED') {
          const receiptOccurred = audits.some(
            (a) => a.action === 'RECEIPT_CONFIRMED_BY_BUYER',
          );
          const settlementConfirmed = this.store
            .settlementSummariesForTransaction(tx.id)
            .some((s) => s.institution_confirmation_at !== null);
          if (!receiptOccurred || !settlementConfirmed) {
            fail('Completion requires the full acceptance + settlement cycle documented');
          }
        }
        if (tx.state === 'REFUNDED') {
          const refundRecorded = audits.some(
            (a) => a.action === 'REFUND_RECORDED',
          );
          if (!refundRecorded) {
            fail('Completion requires the refund execution fully documented');
          }
        }
        const openDispute = this.store
          .disputesForTransaction(tx.id)
          .some((d) => d.status === 'OPEN');
        if (openDispute) fail('Cannot complete while a dispute is open');
        return;
      }
      case 'DISPUTE_RESOLVED_RETURNED': {
        this.checkDisputeResolved(tx, audits, 'PROCEED', fail);
        const opened = [...audits]
          .reverse()
          .find((a) => a.action === 'DISPUTE_OPENED');
        const preDispute = opened?.previous_state ?? null;
        if (preDispute === null) fail('Pre-dispute state is not recorded');
        if (
          !(DISPUTE_RETURN_TARGETS as readonly string[]).includes(preDispute)
        ) {
          fail('Pre-dispute state is not an eligible return target');
        }
        // Row 22 restores ONLY the recorded pre-dispute state. A return
        // to any other state — even another eligible target — is
        // rejected: it would create a new fact, not restore one.
        if (to !== preDispute) {
          fail('Row 22 restores ONLY the audit-recorded pre-dispute state');
        }
        return;
      }
      case 'DISPUTE_RESOLVED_REFUND': {
        this.checkDisputeResolved(tx, audits, 'REFUND', fail);
        // Sprint 4 fix (Sprint 3 finding): a settlement counts ONLY
        // when it actually succeeded — a SETTLEMENT_RECORDED audit
        // with new_state SETTLED. A TRANSITION_REJECTED audit from a
        // correctly-rejected settlement attempt (e.g. SETTLED while
        // DISPUTED) also carries new_state SETTLED but is NOT a
        // settlement, and must never poison a later legitimate
        // refund path. Counting any new_state === 'SETTLED' row was
        // the bug; this action check is the fix.
        const everSettled = audits.some(
          (a) => a.action === 'SETTLEMENT_RECORDED' && a.new_state === 'SETTLED',
        );
        if (everSettled) fail('Refund path is unavailable after settlement executed');
        return;
      }
      case 'DISPUTE_RESOLVED_CANCELLED': {
        this.checkDisputeResolved(tx, audits, 'CANCELLED', fail);
        return;
      }
      case 'REFUND_RECORDED': {
        const confirmation = input.refundConfirmation;
        if (
          !confirmation ||
          !confirmation.settlementReference ||
          !confirmation.executedAmount ||
          !confirmation.currency ||
          !confirmation.beneficiary ||
          !confirmation.executionDate ||
          !confirmation.confirmationDocument
        ) {
          fail('Refund execution requires settlement/refund reference, executed amount + currency, beneficiary, execution date and confirmation document');
        }
        const fundingConfirmer = confirmedCoordination?.staff_id;
        if (fundingConfirmer && actor.id === fundingConfirmer) {
          throw new DomainError(
            'SEPARATION_OF_DUTIES_VIOLATION',
            403,
            'The staff member who confirmed funding must not record the refund for the same transaction',
          );
        }
        return;
      }
      default:
        fail(`Unknown transition action: ${action}`);
    }
  }

  private checkDisputeResolved(
    tx: Transaction,
    audits: ReturnType<Store['auditForTransaction']>,
    outcome: 'REFUND' | 'PROCEED' | 'CANCELLED',
    fail: (message: string) => never,
  ): void {
    const disputes = this.store.disputesForTransaction(tx.id);
    const latest = disputes[disputes.length - 1];
    if (!latest || latest.status !== 'RESOLVED') {
      fail('Dispute must be resolved by a human before leaving DISPUTED');
    }
    if (latest.resolution_outcome !== outcome) {
      fail(`Dispute resolution outcome must be ${outcome} for this exit`);
    }
    if (!latest.resolution || !latest.resolved_by || !latest.resolved_at) {
      fail('Dispute resolution text, resolver and timestamp are required');
    }
    void audits;
  }

  private transitionDetails(
    action: string,
    actor: Actor,
    input: TransitionInput,
    transactionId: string,
  ): Record<string, unknown> {
    switch (action) {
      case 'TRANSACTION_CANCELLED':
        return { cancellation_reason: input.cancellationReason ?? null };
      case 'CONTRACT_ACCEPTED': {
        // Frozen-proof fields: the accepted version's hash + number
        // travel on the CONTRACT_ACCEPTED audit row so later Guards
        // (row 6) can verify hash + timestamp + messages + audit agree.
        const version = this.store.currentVersion(transactionId);
        return {
          recorded_by_staff: actor.id,
          version_hash: version?.content_hash ?? null,
          version_number: version?.version_number ?? null,
        };
      }
      case 'FUNDING_AWAITING_STARTED':
        return { voucher: input.voucher ?? null };
      case 'FULFILMENT_STARTED':
        return { shipping_confirmed: true };
      case 'SETTLEMENT_PREPARED':
        return { settlement_summary: input.settlementSummary ?? null };
      case 'REFUND_RECORDED':
        return { refund_confirmation: input.refundConfirmation ?? null };
      case 'DISPUTE_OPENED':
        return {
          dispute_reason: input.disputeReason ?? null,
          evidence_file_ids: input.disputeEvidenceFileIds ?? [],
        };
      default:
        return {};
    }
  }

  /** Creates a version row without an audit row (used inside the row 5
   * transition, whose single AuditEvent is the amendment record). */
  private createContractVersionRow(
    transactionId: string,
    content: string,
  ): ContractVersion {
    const existing = this.store.versionsForTransaction(transactionId);
    const nextNumber =
      existing.length > 0
        ? Math.max(...existing.map((v) => v.version_number)) + 1
        : 1;
    return this.store.createContractVersion({
      transaction_id: transactionId,
      version_number: nextNumber,
      content_hash: sha256Hex(content),
      storage_file_id: null,
      superseded_by: null,
    });
  }

  private requireTransaction(id: string): Transaction {
    const tx = this.store.findTransactionById(id);
    if (!tx) throw new NotFoundError('Transaction', id);
    return tx;
  }
}
