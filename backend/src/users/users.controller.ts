// Pilot System v3.1 — Sprint 3 (PB-15, PB-23). Person identity HTTP
// surface: create a person (one UUID + one WhatsApp number), approve,
// suspend. Buyer/Seller is NOT set here — it lives only on
// TransactionParty per transaction. All routes are staff-only (JWT);
// approve/suspend additionally require their backend permissions
// (403 on violation).
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { mapDomainError } from '../common/http-errors';
import { UsersService } from './users.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post()
  create(
    @Body() body: { whatsappNumber: string; status?: 'APPROVED' | 'NOT_APPROVED' | 'SUSPENDED' },
  ): Record<string, unknown> {
    return mapDomainError(() =>
      this.users.createPerson(body.whatsappNumber, body.status),
    ) as unknown as Record<string, unknown>;
  }

  @Get(':id')
  get(@Param('id') id: string): Record<string, unknown> {
    return mapDomainError(() => this.users.findById(id)) as unknown as Record<
      string,
      unknown
    >;
  }

  @RequirePermission('users.approve')
  @Post(':id/approve')
  approve(@Param('id') id: string): Record<string, unknown> {
    return mapDomainError(() => this.users.approve(id)) as unknown as Record<
      string,
      unknown
    >;
  }

  @RequirePermission('users.suspend')
  @Post(':id/suspend')
  suspend(@Param('id') id: string): Record<string, unknown> {
    return mapDomainError(() => this.users.suspend(id)) as unknown as Record<
      string,
      unknown
    >;
  }
}
