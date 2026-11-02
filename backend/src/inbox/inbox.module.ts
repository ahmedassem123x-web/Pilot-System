// Pilot System v3.1 — Sprint 4 (PB-13). Inbox module: read model +
// triage metadata only. No transaction, funding, settlement, or
// acceptance logic lives here.
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InboxController } from './inbox.controller';
import { InboxService } from './inbox.service';

@Module({
  imports: [AuthModule],
  controllers: [InboxController],
  providers: [InboxService],
  exports: [InboxService],
})
export class InboxModule {}
