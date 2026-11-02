import { Module } from '@nestjs/common';
import { InMemoryStore } from '../store/in-memory.store';
import { BackupService } from './backup.service';

@Module({
  providers: [
    {
      provide: BackupService,
      useFactory: (store: InMemoryStore) => new BackupService(store),
      inject: [InMemoryStore],
    },
  ],
  exports: [BackupService],
})
export class BackupModule {}
