// Pilot System v3.1 — Sprint 2. Auth wiring. The JWT secret comes ONLY
// from the environment variable NAME JWT_SECRET — never a value in
// code. When it is absent, AuthService constructs but sign/verify
// throw at call time; nothing silently authenticates.
import { Module } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InMemoryStore } from '../store/in-memory.store';
import { AuthService } from './auth.service';
import { RbacService } from './rbac.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PermissionsGuard } from './permissions.guard';
import { AuthController } from './auth.controller';
import { BootstrapService } from './bootstrap.service';

@Module({
  providers: [
    {
      provide: AuthService,
      useFactory: () =>
        new AuthService({ jwtSecret: process.env.JWT_SECRET }),
    },
    {
      provide: RbacService,
      useFactory: (store: InMemoryStore) => new RbacService(store),
      inject: [InMemoryStore],
    },
    {
      provide: JwtAuthGuard,
      useFactory: (auth: AuthService, rbac: RbacService) =>
        new JwtAuthGuard(auth, rbac),
      inject: [AuthService, RbacService],
    },
    {
      provide: PermissionsGuard,
      useFactory: (reflector: Reflector) => new PermissionsGuard(reflector),
      inject: [Reflector],
    },
    {
      provide: BootstrapService,
      useFactory: (
        store: InMemoryStore,
        auth: AuthService,
        rbac: RbacService,
      ) => new BootstrapService(store, auth, rbac),
      inject: [InMemoryStore, AuthService, RbacService],
    },
  ],
  controllers: [AuthController],
  exports: [AuthService, RbacService, JwtAuthGuard, PermissionsGuard],
})
export class AuthModule {}
