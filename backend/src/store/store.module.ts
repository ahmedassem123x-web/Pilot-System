// Pilot System v3.1 — Sprint 2. Global store provider so every
// feature module shares ONE store instance. Sprint 3 replaces the
// class below with the Prisma implementation; no service changes.
import { Global, Module } from '@nestjs/common';
import { InMemoryStore } from './in-memory.store';

@Global()
@Module({
  providers: [{ provide: InMemoryStore, useClass: InMemoryStore }],
  exports: [InMemoryStore],
})
export class StoreModule {}
