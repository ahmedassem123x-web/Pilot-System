// Pilot System v3.1 — Sprint 3 (PB-15). READ-ONLY audit HTTP surface.
// There is deliberately NO update, delete, or rewrite route here: the
// audit log is append-only, and the service layer refuses updates and
// deletes with IMMUTABLE_ROW. Staff-only (JWT) + `audit.view`
// permission (backend 403 on violation).
import {
  Controller,
  Get,
  Param,
  UseGuards,
} from '@nestjs/common';
import { SetMetadata } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { PERMISSION_KEY } from '../auth/require-permission.decorator';
import { AuditService } from './audit.service';
import { InMemoryStore } from '../store/in-memory.store';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@SetMetadata(PERMISSION_KEY, 'audit.view')
@Controller('api/audit')
export class AuditController {
  constructor(
    private readonly audit: AuditService,
    private readonly store: InMemoryStore,
  ) {}

  @Get(':transactionId')
  forTransaction(
    @Param('transactionId') transactionId: string,
  ): Record<string, unknown>[] {
    return this.audit.forTransaction(
      transactionId,
    ) as unknown as Record<string, unknown>[];
  }

  @Get()
  all(): Record<string, unknown>[] {
    return this.store.allAuditEvents() as unknown as Record<string, unknown>[];
  }
}
