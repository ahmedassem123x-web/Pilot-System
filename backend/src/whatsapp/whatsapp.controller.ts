// Pilot System v3.1 — Sprint 3 (PB-11, PB-12). WhatsApp HTTP surface.
//
// The webhook routes below carry NO JWT guard: Meta calls them, not
// staff. Their authentication is the HMAC signature (see
// whatsapp.service.ts). Every staff route in this controller carries
// JwtAuthGuard. The webhook NEVER performs a state transition,
// financial step, or acceptance decision — it verifies, deduplicates,
// records, and enqueues only.
//
// RAW BODY: main.ts enables Nest rawBody. If rawBody is ever absent,
// the request cannot be verified over its raw bytes, so it is
// rejected (the service treats an unverifiable signature as a
// failure) — a re-serialised body is never used for verification.
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { mapDomainError, mapDomainErrorAsync } from '../common/http-errors';
import { QueueService } from '../queue/queue.service';
import { TemplatesService } from './templates.service';
import { WhatsappService } from './whatsapp.service';

@Controller('api/whatsapp')
export class WhatsappController {
  constructor(
    private readonly whatsapp: WhatsappService,
    private readonly templates: TemplatesService,
    private readonly queue: QueueService,
  ) {}

  @Get('webhook')
  verifySubscription(
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') token: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
    @Res() res: Response,
  ): void {
    const answer = this.whatsapp.verifySubscription(mode, token, challenge);
    if (answer === null) {
      throw new ForbiddenException('Webhook verification token mismatch');
    }
    res.status(200).send(answer);
  }

  @Post('webhook')
  @HttpCode(200)
  handleWebhook(
    @Req()
    req: {
      rawBody?: Buffer;
      headers: Record<string, string | undefined>;
      body: unknown;
    },
  ): Record<string, unknown> {
    const rawBody = req.rawBody ?? Buffer.alloc(0);
    const result = this.whatsapp.handleWebhook(
      req.body,
      rawBody,
      req.headers['x-hub-signature-256'],
    );
    if (result.outcome === 'rejected') {
      throw new ForbiddenException(result.reason ?? 'Signature verification failed');
    }
    return result as unknown as Record<string, unknown>;
  }

  /** Staff-only: drain queued jobs explicitly (no background runner). */
  @UseGuards(JwtAuthGuard)
  @Post('queue/process')
  async processQueue(): Promise<Record<string, unknown>> {
    const processed = await this.queue.processPending({
      'whatsapp.inbound.process': () => {
        // Async processing note only: the MessageLog row already
        // exists (created by the webhook). No state, financial, or
        // acceptance effect happens here, by design.
      },
      'reminder.send': () => undefined,
      'escalation.notify': () => undefined,
    });
    return {
      processed: processed.map((job) => ({
        id: job.id,
        name: job.name,
        status: job.status,
        attempts: job.attempts,
      })),
    };
  }

  @UseGuards(JwtAuthGuard)
  @Get('templates')
  listTemplates(): Record<string, unknown>[] {
    return this.templates.listTemplates().map((template) => ({
      name: template.name,
      category: template.category,
      // Shown SEPARATELY, never merged into one approval.
      local_approval: template.localApproval,
      meta_approval: template.metaApproval,
      rejection_reason: template.rejectionReason,
      sendable:
        template.localApproval === 'APPROVED' &&
        template.metaApproval === 'APPROVED',
    }));
  }

  @UseGuards(JwtAuthGuard)
  @Post('templates')
  registerTemplate(
    @Body()
    body: {
      name: string;
      localApproval: 'PENDING' | 'APPROVED' | 'REJECTED';
      metaApproval: 'PENDING' | 'APPROVED' | 'REJECTED';
      rejectionReason?: string | null;
    },
  ): Record<string, unknown> {
    return mapDomainError(() =>
      this.templates.registerTemplate(
        body.name,
        body.localApproval,
        body.metaApproval,
        body.rejectionReason ?? null,
      ),
    ) as unknown as Record<string, unknown>;
  }

  @UseGuards(JwtAuthGuard)
  @Post('messages')
  async sendMessage(
    @Body()
    body: {
      transactionId?: string | null;
      to: string;
      kind: 'text' | 'template';
      text?: string;
      templateName?: string;
      buttons?: Array<{ id: string; title: string }>;
      listItems?: Array<{ id: string; title: string }>;
      lastInboundAt?: string | null;
    },
  ): Promise<Record<string, unknown>> {
    const result = await mapDomainErrorAsync(() =>
      this.templates.sendMessage({
        transactionId: body.transactionId ?? null,
        to: body.to,
        kind: body.kind,
        text: body.text,
        templateName: body.templateName,
        buttons: body.buttons,
        listItems: body.listItems,
        lastInboundAt: body.lastInboundAt ? new Date(body.lastInboundAt) : null,
      }),
    );
    return {
      messageLog: result.messageLog,
      // Labelled dry-run in the same payload, every time.
      dry_run: true,
      counted_as_sent: false,
    };
  }
}
