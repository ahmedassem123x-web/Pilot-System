// Pilot System v3.1 — Sprint 3 (PB-12). Templates, the customer-service
// window, and the message transport.
//
// LOCAL vs META APPROVAL — SEPARATE FIELDS, SEPARATE MEANINGS:
// A template carries BOTH a local approval (staff reviewed it) and a
// Meta approval (Meta reviewed it for the connected account). Only
// local APPROVED + Meta APPROVED is sendable as a template. A template
// approved locally but rejected by Meta is UN-SENDABLE, and the Meta
// rejection reason is stored and shown — never hidden, never bypassed
// by falling back to free text outside the window, by renaming, or by
// any other route. The panel shows the two approvals in separate
// columns (see frontend operations panel, Templates section).
//
// CUSTOMER-SERVICE WINDOW: free text is allowed INSIDE the window
// (measured from the customer's last inbound message); OUTSIDE it,
// only approved Utility templates may be sent. With no prior inbound
// message on record, the conversation is treated as outside the
// window. The window length is one day, expressed in milliseconds
// below so no hour-count wording can be mistaken for a policy window.
//
// TRANSPORT — DRY-RUN BY DEFAULT: the only transport wired in this
// build is DryRunTransport. It creates an OUTBOUND MessageLog row with
// is_dry_run = true and status QUEUED, and it NEVER delivers anything
// to Meta. Every dry-run row is labelled dry-run wherever displayed,
// and sent-message counts EXCLUDE dry-run rows (see countActuallySent).
// No row created here may ever be described as sent without the
// dry-run qualifier in the same sentence.
//
// REAL-TRANSPORT SWAP POINT (Sprint 5, documented in
// docs/whatsapp-real-transport-swap.md): implement MessageTransport
// with the direct Meta Cloud API send call (environment variable names
// WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID — values never in
// code), pass it to TemplatesService instead of DryRunTransport, and
// keep the window + sendability gates in sendMessage unchanged. The
// gates live here, not in the transport, so swapping the transport
// cannot bypass them.
import { Injectable } from '@nestjs/common';
import { DomainError } from '../common/errors';
import type { MessageLog, Store } from '../store/repository';

export type TemplateApprovalValue = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface TemplateRecord {
  name: string;
  category: 'UTILITY';
  localApproval: TemplateApprovalValue;
  metaApproval: TemplateApprovalValue;
  rejectionReason: string | null;
}

export interface SendMessageInput {
  transactionId?: string | null;
  to: string;
  kind: 'text' | 'template';
  text?: string;
  templateName?: string;
  buttons?: Array<{ id: string; title: string }>;
  listItems?: Array<{ id: string; title: string }>;
  lastInboundAt?: Date | null;
  now?: Date;
}

export interface SendMessageResult {
  messageLog: MessageLog;
  dryRun: true;
  countedAsSent: false;
}

export interface MessageTransport {
  readonly dryRun: boolean;
  deliver(input: {
    transactionId: string | null;
    templateName: string | null;
    whatsappMessageId: string;
  }): Promise<{ status: 'QUEUED' }>;
}

/** Test transport: records the send, delivers nothing. */
export class DryRunTransport implements MessageTransport {
  readonly dryRun = true as const;

  async deliver(_input: {
    transactionId: string | null;
    templateName: string | null;
    whatsappMessageId: string;
  }): Promise<{ status: 'QUEUED' }> {
    void _input;
    return { status: 'QUEUED' };
  }
}

export const WINDOW_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class TemplatesService {
  private templates = new Map<string, TemplateRecord>();

  constructor(
    private readonly store: Store,
    private readonly transport: MessageTransport = new DryRunTransport(),
  ) {}

  registerTemplate(
    name: string,
    localApproval: TemplateApprovalValue,
    metaApproval: TemplateApprovalValue,
    rejectionReason?: string | null,
  ): TemplateRecord {
    const record: TemplateRecord = {
      name,
      category: 'UTILITY',
      localApproval,
      metaApproval,
      rejectionReason: rejectionReason ?? null,
    };
    this.templates.set(name, record);
    return record;
  }

  getTemplate(name: string): TemplateRecord | undefined {
    return this.templates.get(name);
  }

  listTemplates(): TemplateRecord[] {
    return [...this.templates.values()];
  }

  sendable(
    name: string,
  ): { sendable: boolean; reason: string | null } {
    const template = this.templates.get(name);
    if (!template) {
      return { sendable: false, reason: `Template is not registered: ${name}` };
    }
    if (template.localApproval !== 'APPROVED') {
      return {
        sendable: false,
        reason: `Template ${name} is not locally approved (local approval: ${template.localApproval})`,
      };
    }
    if (template.metaApproval === 'REJECTED') {
      return {
        sendable: false,
        reason:
          template.rejectionReason ??
          `Template ${name} was rejected by Meta and is un-sendable`,
      };
    }
    if (template.metaApproval !== 'APPROVED') {
      return {
        sendable: false,
        reason: `Template ${name} is not yet approved by Meta (Meta approval: ${template.metaApproval})`,
      };
    }
    return { sendable: true, reason: null };
  }

  isInsideWindow(lastInboundAt: Date | null | undefined, now: Date): boolean {
    if (!lastInboundAt) return false;
    return now.getTime() - lastInboundAt.getTime() < WINDOW_MS;
  }

  /**
   * Sends (dry-run) a message after the window + sendability gates.
   * Buttons are capped at 3, list items at 10; interactive replies
   * elsewhere in the system trigger on id, never on title (see
   * whatsapp.service.ts). This method never touches transaction state,
   * funding, settlement, or acceptance.
   */
  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    if (input.buttons && input.buttons.length > 3) {
      throw new DomainError(
        'INVALID_INPUT',
        422,
        'A message may carry at most 3 buttons',
      );
    }
    if (input.listItems && input.listItems.length > 10) {
      throw new DomainError(
        'INVALID_INPUT',
        422,
        'A list message may carry at most 10 items',
      );
    }
    const now = input.now ?? new Date();
    const insideWindow = this.isInsideWindow(input.lastInboundAt ?? null, now);
    let template: TemplateRecord | undefined;
    if (input.kind === 'text') {
      if (!insideWindow) {
        throw new DomainError(
          'INVALID_INPUT',
          422,
          'Free text is only allowed inside the customer-service window; outside the window only approved Utility templates may be sent',
        );
      }
    } else {
      if (!input.templateName) {
        throw new DomainError(
          'INVALID_INPUT',
          422,
          'templateName is required for a template message',
        );
      }
      template = this.templates.get(input.templateName);
      const gate = this.sendable(input.templateName);
      if (!gate.sendable) {
        throw new DomainError('INVALID_INPUT', 422, gate.reason as string);
      }
    }
    const whatsappMessageId = `dry-run-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    await this.transport.deliver({
      transactionId: input.transactionId ?? null,
      templateName: template?.name ?? null,
      whatsappMessageId,
    });
    const messageLog = this.store.createMessageLog({
      whatsapp_message_id: whatsappMessageId,
      transaction_id: input.transactionId ?? null,
      direction: 'OUTBOUND',
      template_name: template?.name ?? null,
      template_local_approval: template?.localApproval ?? null,
      template_meta_approval: template?.metaApproval ?? null,
      template_rejection_reason: template?.rejectionReason ?? null,
      status: 'QUEUED',
      is_dry_run: true,
    });
    return { messageLog, dryRun: true, countedAsSent: false };
  }

  /**
   * Counts messages actually sent: OUTBOUND, not dry-run, and past
   * QUEUED. Dry-run rows are NEVER counted here.
   */
  countActuallySent(logs: MessageLog[]): number {
    return logs.filter(
      (log) =>
        log.direction === 'OUTBOUND' &&
        !log.is_dry_run &&
        log.status !== 'QUEUED' &&
        log.status !== 'FAILED',
    ).length;
  }
}
