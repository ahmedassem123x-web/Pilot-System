import { Module } from '@nestjs/common';
import { InMemoryStore } from '../store/in-memory.store';
import { AuthModule } from '../auth/auth.module';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  providers: [
    {
      provide: UsersService,
      useFactory: (store: InMemoryStore) => new UsersService(store),
      inject: [InMemoryStore],
    },
  ],
  imports: [AuthModule],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}
