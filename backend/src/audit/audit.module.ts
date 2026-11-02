import { Module } from '@nestjs/common';
import { InMemoryStore } from '../store/in-memory.store';
import { AuthModule } from '../auth/auth.module';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';

@Module({
  providers: [
    {
      provide: AuditService,
      useFactory: (store: InMemoryStore) => new AuditService(store),
      inject: [InMemoryStore],
    },
  ],
  imports: [AuthModule],
  controllers: [AuditController],
  exports: [AuditService],
})
export class AuditModule {}
