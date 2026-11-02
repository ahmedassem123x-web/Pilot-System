// Pilot System v3.1 — Sprint 3 (PB-11). WhatsApp webhook: HMAC
// verification, idempotency, status monotonicity, interactive replies.
//
// WHAT THIS MODULE NEVER DOES (enforced by design + negative tests):
// it never calls the transaction service, never performs a state
// transition, never records funding, settlement, or acceptance, and
// never treats a WhatsApp message as institution confirmation. The
// webhook verifies, deduplicates, records MessageLog rows, applies
// delivery-status updates, and enqueues async work. Everything else
// is staff work in the operations panel.
//
// VERIFICATION ORDER (exact):
// 1. Read the RAW request body bytes (Nest rawBody) — never a
//    re-serialised body — and the signature header
//    `x-hub-signature-256` (`sha256=<hex>`).
// 2. Compute HMAC SHA-256 over the raw bytes with the app secret
//    (environment variable name WHATSAPP_APP_SECRET; value never in
//    code). No secret configured => reject.
// 3. Compare with a CONSTANT-TIME comparison. Missing or mismatched
//    signature => HTTP 403, one audit entry, and NO MessageLog row,
//    no state change, no outbound message.
// 4. On match only: idempotency by whatsapp_message_id (UNIQUE). A
//    duplicate is answered as already-processed with NO duplicate
//    effect: no second row, no second job effect, no state change.
// 5. Heavy work is enqueued (queue module) for async processing; the
//    webhook itself does not do it synchronously.
//
// STATUS MONOTONICITY: QUEUED -> SENT -> DELIVERED -> READ, FAILED
// from any state. A status update that would move a message backwards
// (except to FAILED) is IGNORED — logged in the result summary, never
// applied. Timestamps follow the applied status.
//
// INTERACTIVE REPLIES: button and list replies trigger on the reply
// ID, never on the title text. A reply carrying a title but no id is
// recorded as ignored and triggers NOTHING. The recorded id is an
// audit note only — it never drives a transition here.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { QueueService } from '../queue/queue.service';
import type { MessageLog, Store } from '../store/repository';

export interface WhatsappServiceOptions {
  appSecret?: string;
  verifyToken?: string;
}

export type MessageStatusValue = MessageLog['status'];

const STATUS_RANK: Record<MessageStatusValue, number> = {
  QUEUED: 0,
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
  FAILED: -1,
};

export interface WebhookResult {
  outcome: 'processed' | 'already-processed' | 'rejected';
  httpStatus: number;
  reason?: string;
  processed?: number;
  duplicates?: number;
  statusesApplied?: number;
  statusesIgnored?: number;
  interactiveReceived?: string[];
}

@Injectable()
export class WhatsappService {
  private readonly appSecret?: string;
  private readonly verifyToken?: string;

  constructor(
    private readonly store: Store,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    options: WhatsappServiceOptions = {},
  ) {
    this.appSecret = options.appSecret;
    this.verifyToken = options.verifyToken;
  }

  /** GET subscription verification: returns the challenge on a token match, else null. */
  verifySubscription(
    mode: string | undefined,
    token: string | undefined,
    challenge: string | undefined,
  ): string | null {
    if (
      mode === 'subscribe' &&
      token !== undefined &&
      this.verifyToken !== undefined &&
      token === this.verifyToken &&
      challenge !== undefined
    ) {
      return challenge;
    }
    return null;
  }

  verifySignature(
    rawBody: Buffer,
    signatureHeader: string | undefined,
  ): boolean {
    if (!this.appSecret) return false;
    if (!signatureHeader) return false;
    const match = /^sha256=([0-9a-fA-F]+)$/.exec(signatureHeader);
    if (!match) return false;
    const expected = createHmac('sha256', this.appSecret)
      .update(rawBody)
      .digest();
    const supplied = Buffer.from(match[1], 'hex');
    if (supplied.length !== expected.length) return false;
    return timingSafeEqual(supplied, expected);
  }

  /**
   * Applies a delivery-status update with monotonicity. Returns
   * 'applied', 'ignored-downgrade', or 'unknown-message'. FAILED
   * always applies. This method never touches transaction state.
   */
  applyStatusUpdate(
    whatsappMessageId: string,
    next: MessageStatusValue,
  ): 'applied' | 'ignored-downgrade' | 'unknown-message' {
    const log = this.store.findMessageLogByWhatsappId(whatsappMessageId);
    if (!log) return 'unknown-message';
    if (next === 'FAILED' || STATUS_RANK[next] >= STATUS_RANK[log.status]) {
      const patch: Partial<MessageLog> = { status: next };
      const now = new Date();
      if (next === 'SENT') patch.sent_at = now;
      if (next === 'DELIVERED') patch.delivered_at = now;
      if (next === 'READ') patch.read_at = now;
      this.store.updateMessageLog(log.id, patch);
      return 'applied';
    }
    return 'ignored-downgrade';
  }

  handleWebhook(
    payload: unknown,
    rawBody: Buffer,
    signatureHeader: string | undefined,
  ): WebhookResult {
    if (!this.verifySignature(rawBody, signatureHeader)) {
      this.audit.record({
        transactionId: null,
        actorId: null,
        actorRole: 'SYSTEM',
        action: 'WEBHOOK_SIGNATURE_REJECTED',
        previousState: null,
        newState: null,
        details: { reason: 'missing or mismatched signature, or no app secret configured' },
      });
      return {
        outcome: 'rejected',
        httpStatus: 403,
        reason: 'Signature verification failed',
      };
    }
    const body = (payload ?? {}) as Record<string, unknown>;
    const entries = Array.isArray(body.entry) ? body.entry : [];
    let processed = 0;
    let duplicates = 0;
    let statusesApplied = 0;
    let statusesIgnored = 0;
    const interactiveReceived: string[] = [];

    for (const entry of entries as Array<Record<string, unknown>>) {
      const changes = Array.isArray(entry.changes) ? entry.changes : [];
      for (const change of changes as Array<Record<string, unknown>>) {
        const value = (change.value ?? {}) as Record<string, unknown>;
        const messages = Array.isArray(value.messages) ? value.messages : [];
        for (const message of messages as Array<Record<string, unknown>>) {
          const id = message.id as string | undefined;
          if (!id) continue;
          const existing = this.store.findMessageLogByWhatsappId(id);
          if (existing) {
            duplicates += 1;
            this.audit.record({
              transactionId: existing.transaction_id,
              actorId: null,
              actorRole: 'SYSTEM',
              action: 'WEBHOOK_DUPLICATE_RECOGNISED',
              previousState: null,
              newState: null,
              details: { whatsapp_message_id: id },
            });
            continue;
          }
          this.store.createMessageLog({
            whatsapp_message_id: id,
            direction: 'INBOUND',
            status: 'DELIVERED',
          });
          processed += 1;
          // Interactive replies: id only, never title.
          if (message.type === 'interactive') {
            const interactive = (message.interactive ?? {}) as Record<
              string,
              unknown
            >;
            const reply = ((interactive.button_reply ??
              interactive.list_reply) ?? {}) as Record<string, unknown>;
            const replyId = reply.id as string | undefined;
            if (replyId) {
              interactiveReceived.push(replyId);
              this.audit.record({
                transactionId: null,
                actorId: null,
                actorRole: 'SYSTEM',
                action: 'WHATSAPP_INTERACTIVE_RECEIVED',
                previousState: null,
                newState: null,
                details: { interactive_id: replyId },
              });
            } else {
              this.audit.record({
                transactionId: null,
                actorId: null,
                actorRole: 'SYSTEM',
                action: 'WHATSAPP_INTERACTIVE_IGNORED_NO_ID',
                previousState: null,
                newState: null,
                details: { reason: 'interactive reply without an id triggers nothing' },
              });
            }
          }
          this.queue.enqueue('whatsapp.inbound.process', {
            whatsapp_message_id: id,
          });
        }
        const statuses = Array.isArray(value.statuses) ? value.statuses : [];
        for (const status of statuses as Array<Record<string, unknown>>) {
          const id = status.id as string | undefined;
          const next = status.status as string | undefined;
          if (!id || !next) continue;
          if (
            next !== 'QUEUED' &&
            next !== 'SENT' &&
            next !== 'DELIVERED' &&
            next !== 'READ' &&
            next !== 'FAILED'
          ) {
            statusesIgnored += 1;
            continue;
          }
          const result = this.applyStatusUpdate(
            id,
            next as MessageStatusValue,
          );
          if (result === 'applied') statusesApplied += 1;
          else statusesIgnored += 1;
        }
      }
    }
    if (processed === 0 && duplicates > 0) {
      return {
        outcome: 'already-processed',
        httpStatus: 200,
        processed,
        duplicates,
        statusesApplied,
        statusesIgnored,
        interactiveReceived,
      };
    }
    return {
      outcome: 'processed',
      httpStatus: 200,
      processed,
      duplicates,
      statusesApplied,
      statusesIgnored,
      interactiveReceived,
    };
  }
}
