import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { StoreModule } from './store/store.module';
import { AuditModule } from './audit/audit.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { TransactionsModule } from './transactions/transactions.module';
import { QueueModule } from './queue/queue.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { InboxModule } from './inbox/inbox.module';
import { FilesModule } from './files/files.module';
import { BackupModule } from './backup/backup.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [
    StoreModule,
    AuditModule,
    UsersModule,
    AuthModule,
    TransactionsModule,
    QueueModule,
    WhatsappModule,
    InboxModule,
    FilesModule,
    BackupModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
