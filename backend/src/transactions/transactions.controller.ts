// Pilot System v3.1 — Sprint 3 (PB-15 to PB-22). Transaction HTTP
// surface for the ONE staff-only operations panel. Every route here
// calls a Sprint 2 service and NEVER bypasses its Guards; this file
// adds transport only (JWT actor extraction, body-to-input mapping,
// error-code mapping). No Guard logic lives here and none was changed
// to write it — see docs/service-interface.md.
//
// PERMISSIONS: static-permission routes use RequirePermission
// (backend 403). The transition route resolves its permission
// DYNAMICALLY from the transition table inside the service Guard:
// the service checks the row's permission against the actor and
// rejects with PERMISSION_DENIED (403) plus a TRANSITION_REJECTED
// audit entry, so a controller-level static permission cannot drift
// from the table.
//
// WHAT IS DELIBERATELY NOT HERE (and nowhere else in the API): any
// route that moves money, executes a settlement or refund, confirms
// funding without institution confirmation, overrides an institution
// outcome, creates a financial account of any kind, changes a
// beneficiary from a message, imposes acceptance, closes on behalf of
// a buyer, or amends a contract after shipping. The forbidden-
// endpoints spec proves the absence by route list + source grep.
//
// MONEY NOTE: Transaction.amount is DESCRIPTIVE ONLY. No endpoint
// here computes a fee, a commission, or a distribution from it.
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { mapDomainError } from '../common/http-errors';
import { AuditService } from '../audit/audit.service';
import { InMemoryStore } from '../store/in-memory.store';
import type { TransactionState } from '../common/transaction-state';
import {
  TransactionsService,
  type Actor,
  type TransitionInput,
} from './transactions.service';

interface RequestActor {
  id: string;
  role: string;
  permissions: string[];
}

interface TransitionBody {
  to: TransactionState;
  correlationId?: string;
  cancellationReason?: string;
  bothPartiesAgreement?: boolean;
  buyerApprovedAmendment?: boolean;
  sellerApprovedAmendment?: boolean;
  newContractContent?: string;
  newContractStorageFileId?: string | null;
  voucher?: {
    buyerName: string;
    sellerName: string;
    purpose: string;
    amount: number;
    currency: string;
    paymentReferenceText: string;
    channelInstructions?: string | null;
  };
  shippingConfirmed?: boolean;
  disputeReason?: string;
  disputeEvidenceFileIds?: string[];
  settlementSummary?: {
    deposit_reference: string;
    amount: number;
    currency: string;
    beneficiary_name: string;
    delivery_proof_or_dispute_outcome: string;
  };
  beneficiaryChangedFromWhatsappMessage?: boolean;
  refundConfirmation?: {
    settlementReference: string;
    executedAmount: number;
    currency: string;
    beneficiary: string;
    receivingMethod?: string | null;
    executionDate: string;
    confirmationDocument: string;
  };
}

/** Voucher fields per CORE PROMPT §11.1 — configurable, never fixed. */
export const VOUCHER_FIELDS = [
  'internal_transaction_number',
  'buyer_name',
  'seller_name',
  'payment_purpose_description',
  'amount_and_currency',
  'payment_reference_or_transfer_text',
  'channel_or_entity_or_receiving_account_data_when_approved',
  'channel_specific_instructions_if_any',
] as const;

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api/transactions')
export class TransactionsController {
  constructor(
    private readonly txs: TransactionsService,
    private readonly audit: AuditService,
    private readonly store: InMemoryStore,
  ) {}

  private actor(req: { actor?: RequestActor }): Actor {
    return {
      id: req.actor?.id ?? '',
      role: 'STAFF',
      permissions: req.actor?.permissions ?? [],
    };
  }

  @RequirePermission('transactions.create')
  @Post()
  create(
    @Req() req: { actor?: RequestActor },
    @Body()
    body: {
      amount: number;
      currency: string;
      product_description: string;
      quantity: number;
      delivery_point: string;
      cancellation_terms: string;
      buyerUserId?: string;
      sellerUserId?: string;
    },
  ): Record<string, unknown> {
    return mapDomainError(() => {
      const input = {
        amount: body.amount,
        currency: body.currency,
        product_description: body.product_description,
        quantity: body.quantity,
        delivery_point: body.delivery_point,
        cancellation_terms: body.cancellation_terms,
      };
      if (body.buyerUserId && body.sellerUserId) {
        return this.txs.createTransactionWithParties(
          input,
          body.buyerUserId,
          body.sellerUserId,
        );
      }
      return this.txs.createTransaction(input);
    }) as unknown as Record<string, unknown>;
  }

  @Get(':id')
  detail(@Param('id') id: string): Record<string, unknown> {
    return mapDomainError(() => {
      const tx = this.txs.getTransaction(id);
      return {
        transaction: tx,
        parties: this.store.partiesForTransaction(id),
        contract_versions: this.store.versionsForTransaction(id),
        current_version: this.store.currentVersion(id) ?? null,
        payment_evidences: this.store.evidencesForTransaction(id),
        coordination_records: this.store.coordinationsForTransaction(id),
        delivery_events: this.store.deliveryEventsForTransaction(id),
        disputes: this.store.disputesForTransaction(id),
        settlement_summaries:
          this.store.settlementSummariesForTransaction(id),
        message_logs: this.store.messageLogsForTransaction(id),
        audit: this.store.auditForTransaction(id),
      };
    }) as unknown as Record<string, unknown>;
  }

  @Post(':id/parties')
  addParty(
    @Param('id') id: string,
    @Body() body: { userId: string; role: 'BUYER' | 'SELLER' },
  ): Record<string, unknown> {
    return mapDomainError(() =>
      this.txs.addParty(id, body.userId, body.role),
    ) as unknown as Record<string, unknown>;
  }

  @Post(':id/contract-versions')
  createVersion(
    @Param('id') id: string,
    @Body() body: { content: string; storageFileId?: string | null },
  ): Record<string, unknown> {
    return mapDomainError(() =>
      this.txs.createContractVersion(
        id,
        body.content,
        body.storageFileId ?? null,
      ),
    ) as unknown as Record<string, unknown>;
  }

  /**
   * The single transition entry point. The service Guard resolves the
   * row permission from the transition table and rejects (403 +
   * audit) on violation; this controller adds no second permission
   * table that could drift from it.
   */
  @Post(':id/transition')
  transition(
    @Req() req: { actor?: RequestActor },
    @Param('id') id: string,
    @Body() body: TransitionBody,
  ): Record<string, unknown> {
    const input: TransitionInput = {
      correlationId: body.correlationId,
      cancellationReason: body.cancellationReason,
      bothPartiesAgreement: body.bothPartiesAgreement,
      buyerApprovedAmendment: body.buyerApprovedAmendment,
      sellerApprovedAmendment: body.sellerApprovedAmendment,
      newContractContent: body.newContractContent,
      newContractStorageFileId: body.newContractStorageFileId,
      voucher: body.voucher,
      shippingConfirmed: body.shippingConfirmed,
      disputeReason: body.disputeReason,
      disputeEvidenceFileIds: body.disputeEvidenceFileIds,
      settlementSummary: body.settlementSummary,
      beneficiaryChangedFromWhatsappMessage:
        body.beneficiaryChangedFromWhatsappMessage,
      refundConfirmation: body.refundConfirmation,
    };
    return mapDomainError(() =>
      this.txs.transition(id, this.actor(req), body.to, input),
    ) as unknown as Record<string, unknown>;
  }

  @RequirePermission('transactions.accept_contract')
  @Post(':id/party-acceptance')
  partyAcceptance(
    @Req() req: { actor?: RequestActor },
    @Param('id') id: string,
    @Body() body: { partyRole: 'BUYER' | 'SELLER'; whatsappMessageId: string },
  ): Record<string, unknown> {
    return mapDomainError(() => {
      this.txs.recordPartyAcceptance(
        id,
        body.partyRole,
        body.whatsappMessageId,
        this.actor(req).id,
      );
      return { recorded: true };
    });
  }

  @RequirePermission('transactions.record_receipt')
  @Post(':id/handover-acceptance')
  handoverAcceptance(
    @Param('id') id: string,
    @Body() body: { whatsappMessageId: string; buyerUserId: string },
  ): Record<string, unknown> {
    return mapDomainError(() => {
      this.txs.recordHandoverAcceptance(
        id,
        body.whatsappMessageId,
        body.buyerUserId,
      );
      return { recorded: true };
    });
  }

  @RequirePermission('transactions.record_delivery')
  @Post(':id/delivery-events')
  deliveryEvent(
    @Req() req: { actor?: RequestActor },
    @Param('id') id: string,
    @Body()
    body: {
      eventType:
        | 'SELLER_ARRIVED_AT_DELIVERY_POINT'
        | 'HANDOVER_READINESS_NOTIFIED'
        | 'BUYER_ARRIVED_AT_HANDOVER'
        | 'HANDOVER_INSPECTION_COMPLETED'
        | 'OPERATIONAL_EXCEPTION_PRODUCT_ABSENT';
      note?: string | null;
    },
  ): Record<string, unknown> {
    return mapDomainError(() =>
      this.txs.recordDeliveryEvent(
        id,
        body.eventType,
        this.actor(req).id,
        body.note ?? null,
      ),
    ) as unknown as Record<string, unknown>;
  }

  @Post(':id/operational-exception/resolve')
  resolveException(
    @Req() req: { actor?: RequestActor },
    @Param('id') id: string,
  ): Record<string, unknown> {
    return mapDomainError(() => {
      this.txs.resolveOperationalException(id, this.actor(req).id);
      return { resolved: true };
    });
  }

  @Post(':id/evidence')
  submitEvidence(
    @Req() req: { actor?: RequestActor },
    @Param('id') id: string,
    @Body()
    body: {
      channel: string;
      senderName: string;
      beneficiaryNameAsShown?: string | null;
      amount: number;
      currency: string;
      externalPaymentReference: string;
      receiptFileId?: string | null;
      submittedBy?: string;
    },
  ): Record<string, unknown> {
    return mapDomainError(() =>
      this.txs.submitPaymentEvidence({
        transactionId: id,
        channel: body.channel,
        senderName: body.senderName,
        beneficiaryNameAsShown: body.beneficiaryNameAsShown ?? null,
        amount: body.amount,
        currency: body.currency,
        externalPaymentReference: body.externalPaymentReference,
        receiptFileId: body.receiptFileId ?? null,
        submittedBy: body.submittedBy ?? this.actor(req).id,
      }),
    ) as unknown as Record<string, unknown>;
  }

  @Post(':id/coordination')
  recordCoordination(
    @Req() req: { actor?: RequestActor },
    @Param('id') id: string,
    @Body()
    body: {
      contactMethod: string;
      messageSent?: string | null;
      institutionResponse?: string | null;
      depositReference?: string | null;
      settlementReference?: string | null;
      institutionConfirmed?: boolean;
    },
  ): Record<string, unknown> {
    return mapDomainError(() =>
      this.txs.recordCoordination({
        transactionId: id,
        staffId: this.actor(req).id,
        contactMethod: body.contactMethod,
        messageSent: body.messageSent ?? null,
        institutionResponse: body.institutionResponse ?? null,
        depositReference: body.depositReference ?? null,
        settlementReference: body.settlementReference ?? null,
        institutionConfirmed: body.institutionConfirmed ?? false,
      }),
    ) as unknown as Record<string, unknown>;
  }

  @RequirePermission('transactions.record_settlement')
  @Post(':id/settlement-confirmation')
  settlementConfirmation(
    @Req() req: { actor?: RequestActor },
    @Param('id') id: string,
    @Body()
    body: {
      settlementSummaryId: string;
      settlementReference: string;
      confirmationAt: string;
    },
  ): Record<string, unknown> {
    void id;
    return mapDomainError(() =>
      this.txs.recordSettlementConfirmation(body.settlementSummaryId, {
        settlementReference: body.settlementReference,
        confirmationAt: new Date(body.confirmationAt),
        actorId: this.actor(req).id,
      }),
    ) as unknown as Record<string, unknown>;
  }

  @RequirePermission('transactions.resolve_dispute')
  @Post(':id/dispute-resolution')
  resolveDispute(
    @Req() req: { actor?: RequestActor },
    @Param('id') id: string,
    @Body()
    body: { outcome: 'REFUND' | 'PROCEED' | 'CANCELLED'; resolution: string },
  ): Record<string, unknown> {
    return mapDomainError(() =>
      this.txs.resolveDispute(id, {
        outcome: body.outcome,
        resolution: body.resolution,
        resolvedBy: this.actor(req).id,
      }),
    ) as unknown as Record<string, unknown>;
  }

  @Post(':id/amendment')
  requestAmendment(
    @Req() req: { actor?: RequestActor },
    @Param('id') id: string,
    @Body()
    body: {
      newContent: string;
      buyerApproved?: boolean;
      sellerApproved?: boolean;
    },
  ): Record<string, unknown> {
    return mapDomainError(() =>
      this.txs.requestAmendment(id, this.actor(req), {
        newContent: body.newContent,
        buyerApproved: body.buyerApproved,
        sellerApproved: body.sellerApproved,
      }),
    ) as unknown as Record<string, unknown>;
  }

  @RequirePermission('audit.view')
  @Get(':id/audit')
  auditLog(@Param('id') id: string): Record<string, unknown>[] {
    return this.audit.forTransaction(
      id,
    ) as unknown as Record<string, unknown>[];
  }

  /**
   * The FOUR financial references, returned as FOUR SEPARATE fields
   * that are never merged into one value:
   * 1. Transaction ID (internal). 2. External Payment Reference
   * (buyer evidence, source of truth: the evidence row). 3. Financial
   * Institution Deposit Reference (coordination record). 4. Financial
   * Institution Settlement Reference (coordination record, set only
   * after institution confirmation of execution).
   */
  @Get(':id/financial-references')
  financialReferences(@Param('id') id: string): Record<string, unknown> {
    return mapDomainError(() => {
      this.txs.getTransaction(id);
      const evidences = this.store.evidencesForTransaction(id);
      const coordinations = this.store.coordinationsForTransaction(id);
      const confirmed = coordinations.find(
        (c) => c.institution_confirmed === true && c.deposit_reference !== null,
      );
      const withSettlement = coordinations.find(
        (c) => c.settlement_reference !== null,
      );
      return {
        transaction_id: id,
        external_payment_reference:
          evidences.length > 0
            ? evidences[evidences.length - 1].external_payment_reference
            : null,
        financial_institution_deposit_reference:
          confirmed?.deposit_reference ?? null,
        financial_institution_settlement_reference:
          withSettlement?.settlement_reference ?? null,
      };
    }) as unknown as Record<string, unknown>;
  }

  /**
   * Configurable payment-instruction voucher (CORE PROMPT §11.1). The
   * field list is fixed by the specification; the VALUES are not
   * fixed before institution approval — no single beneficiary or
   * account is assumed. The issued voucher (if any) is read back from
   * the FUNDING_AWAITING_STARTED audit row that recorded it.
   */
  @Get(':id/voucher')
  voucher(@Param('id') id: string): Record<string, unknown> {
    return mapDomainError(() => {
      this.txs.getTransaction(id);
      const issued = [...this.store.auditForTransaction(id)]
        .reverse()
        .find((a) => a.action === 'FUNDING_AWAITING_STARTED');
      const details = (issued?.details ?? {}) as Record<string, unknown>;
      return {
        fields: [...VOUCHER_FIELDS],
        voucher: (details.voucher ?? null) as Record<string, unknown> | null,
        note: 'Configurable per institution approval. No detailed financial data is fixed before the institution approves it.',
      };
    }) as unknown as Record<string, unknown>;
  }
}
