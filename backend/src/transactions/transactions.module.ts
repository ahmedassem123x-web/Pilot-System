import { Module } from '@nestjs/common';
import { InMemoryStore } from '../store/in-memory.store';
import { AuditModule } from '../audit/audit.module';
import { AuditService } from '../audit/audit.service';
import { AuthModule } from '../auth/auth.module';
import { TransactionsService } from './transactions.service';
import { TransactionsController } from './transactions.controller';

@Module({
  imports: [AuditModule, AuthModule],
  controllers: [TransactionsController],
  providers: [
    {
      provide: TransactionsService,
      useFactory: (store: InMemoryStore, audit: AuditService) =>
        new TransactionsService(store, audit),
      inject: [InMemoryStore, AuditService],
    },
  ],
  exports: [TransactionsService],
})
export class TransactionsModule {}
