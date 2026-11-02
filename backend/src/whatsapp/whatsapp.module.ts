import { Module } from '@nestjs/common';
import { InMemoryStore } from '../store/in-memory.store';
import { AuditModule } from '../audit/audit.module';
import { AuditService } from '../audit/audit.service';
import { QueueModule } from '../queue/queue.module';
import { QueueService } from '../queue/queue.service';
import { AuthModule } from '../auth/auth.module';
import { DryRunTransport, TemplatesService } from './templates.service';
import { WhatsappService } from './whatsapp.service';
import { WhatsappController } from './whatsapp.controller';

@Module({
  imports: [AuditModule, QueueModule, AuthModule],
  controllers: [WhatsappController],
  providers: [
    {
      provide: TemplatesService,
      useFactory: (store: InMemoryStore) =>
        new TemplatesService(store, new DryRunTransport()),
      inject: [InMemoryStore],
    },
    {
      provide: WhatsappService,
      useFactory: (
        store: InMemoryStore,
        audit: AuditService,
        queue: QueueService,
      ) =>
        new WhatsappService(store, audit, queue, {
          appSecret: process.env.WHATSAPP_APP_SECRET,
          verifyToken:
            process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ??
            process.env.WHATSAPP_VERIFY_TOKEN,
        }),
      inject: [InMemoryStore, AuditService, QueueService],
    },
  ],
  exports: [TemplatesService, WhatsappService],
})
export class WhatsappModule {}
