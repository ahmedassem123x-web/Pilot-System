// Pilot System v3.1 — Sprint 4 (PB-13). Staff-only inbox read
// endpoints + triage metadata endpoints. These routes NEVER bypass a
// Guard: they read MessageLog rows and hold assignment/tag/note
// metadata only. They never transition, fund, settle, accept, or send.
// Internal notes written here are never MessageLog rows (see
// inbox.service.ts) and therefore can never be sent to a customer.
import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { mapDomainError } from '../common/http-errors';
import { InboxService, type TriageValue } from './inbox.service';
import type { MessageLog } from '../store/repository';

@UseGuards(JwtAuthGuard)
@Controller('api/whatsapp')
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  @Get('messages')
  listMessages(
    @Query('transactionId') transactionId?: string,
    @Query('direction') direction?: string,
    @Query('status') status?: string,
  ): MessageLog[] {
    return this.inbox.listMessages({
      transactionId: transactionId || undefined,
      direction:
        direction === 'INBOUND' || direction === 'OUTBOUND'
          ? direction
          : undefined,
      status: status as MessageLog['status'] | undefined,
    });
  }

  @Get('inbox')
  listInbox(
    @Query('search') search?: string,
    @Query('tag') tag?: string,
    @Query('assignedTo') assignedTo?: string,
    @Query('triage') triage?: string,
  ): ReturnType<InboxService['listConversations']> {
    return this.inbox.listConversations({
      search: search || undefined,
      tag: tag || undefined,
      assignedTo: assignedTo || undefined,
      triage: triage as TriageValue | undefined,
    });
  }

  @Get('inbox/:id')
  getInbox(@Param('id') id: string): ReturnType<InboxService['getConversation']> {
    const conversation = this.inbox.getConversation(decodeURIComponent(id));
    if (!conversation) throw new NotFoundException(`Conversation ${id} not found`);
    return conversation;
  }

  @Post('inbox/:id/assign')
  assign(
    @Param('id') id: string,
    @Body() body: { assignedTo: string },
  ): ReturnType<InboxService['assign']> {
    return mapDomainError(() =>
      this.inbox.assign(decodeURIComponent(id), body.assignedTo),
    ) as ReturnType<InboxService['assign']>;
  }

  @Post('inbox/:id/tags')
  setTags(
    @Param('id') id: string,
    @Body() body: { tags: string[] },
  ): ReturnType<InboxService['setTags']> {
    return mapDomainError(() =>
      this.inbox.setTags(decodeURIComponent(id), body.tags),
    ) as ReturnType<InboxService['setTags']>;
  }

  @Post('inbox/:id/triage')
  setTriage(
    @Param('id') id: string,
    @Body() body: { triage: string },
  ): ReturnType<InboxService['setTriage']> {
    return mapDomainError(() =>
      this.inbox.setTriage(decodeURIComponent(id), body.triage),
    ) as ReturnType<InboxService['setTriage']>;
  }

  @Post('inbox/:id/notes')
  addNote(
    @Param('id') id: string,
    @Body() body: { text: string; author: string },
  ): ReturnType<InboxService['addNote']> {
    return mapDomainError(() =>
      this.inbox.addNote(decodeURIComponent(id), body.text, body.author ?? 'staff'),
    ) as ReturnType<InboxService['addNote']>;
  }
}
