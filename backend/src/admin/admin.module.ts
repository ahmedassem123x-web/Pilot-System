import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BackupModule } from '../backup/backup.module';
import { AdminController } from './admin.controller';

@Module({
  imports: [AuthModule, BackupModule],
  controllers: [AdminController],
})
export class AdminModule {}
