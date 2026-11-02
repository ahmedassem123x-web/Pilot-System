// Pilot System v3.1 — Sprint 3 (PB-23, PB-25). Staff administration:
// staff accounts, roles, permissions, and backup export/import. All
// routes are staff-only (JWT) AND require the `admin.manage`
// permission (backend 403 on violation). `admin.manage` is a Sprint 3
// administration permission: it grants no transaction power by
// itself, and it is not a transaction, reporting, or project
// permission of any other kind.
//
// What is deliberately NOT here: any route that moves money, confirms
// funding, overrides an institution outcome, creates a financial
// account of any kind, or changes a beneficiary. Those actions do
// not exist as endpoints anywhere in this codebase (see the
// forbidden-endpoints spec).
import {
  Body,
  Controller,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SetMetadata } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { PERMISSION_KEY } from '../auth/require-permission.decorator';
import { AuthService } from '../auth/auth.service';
import { RbacService } from '../auth/rbac.service';
import { BackupService } from '../backup/backup.service';
import { mapDomainError, mapDomainErrorAsync } from '../common/http-errors';
import type { StoreSnapshot } from '../store/repository';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@SetMetadata(PERMISSION_KEY, 'admin.manage')
@Controller('api/admin')
export class AdminController {
  constructor(
    private readonly auth: AuthService,
    private readonly rbac: RbacService,
    private readonly backup: BackupService,
  ) {}

  @Post('staff')
  async createStaff(
    @Body()
    body: { email: string; password: string; displayName?: string | null },
  ): Promise<Record<string, unknown>> {
    return mapDomainErrorAsync(async () => {
      const hash = await this.auth.hashPassword(body.password);
      const staff = this.rbac.createStaffUser(
        body.email,
        hash,
        body.displayName ?? null,
      );
      // Never return the hash.
      return {
        id: staff.id,
        email: staff.email,
        display_name: staff.display_name,
        is_active: staff.is_active,
      };
    });
  }

  @Post('roles')
  createRole(
    @Body() body: { name: string; description?: string | null },
  ): Record<string, unknown> {
    return mapDomainError(() =>
      this.rbac.createRole(body.name, body.description ?? null),
    ) as unknown as Record<string, unknown>;
  }

  @Post('permissions')
  createPermission(
    @Body() body: { name: string; description?: string | null },
  ): Record<string, unknown> {
    return mapDomainError(() =>
      this.rbac.createPermission(body.name, body.description ?? null),
    ) as unknown as Record<string, unknown>;
  }

  @Post('staff/:staffId/roles')
  assignRole(
    @Param('staffId') staffId: string,
    @Body() body: { roleId: string },
  ): Record<string, unknown> {
    return mapDomainError(() => {
      this.rbac.assignRole(staffId, body.roleId);
      return { staff_id: staffId, role_id: body.roleId };
    });
  }

  @Post('roles/:roleId/permissions')
  grantPermission(
    @Param('roleId') roleId: string,
    @Body() body: { permissionId: string },
  ): Record<string, unknown> {
    return mapDomainError(() => {
      this.rbac.grantPermissionToRole(roleId, body.permissionId);
      return { role_id: roleId, permission_id: body.permissionId };
    });
  }

  @Post('backup/export')
  exportBackup(): StoreSnapshot {
    return this.backup.exportSnapshot();
  }

  @Post('backup/import')
  importBackup(@Body() body: StoreSnapshot): StoreSnapshot {
    return mapDomainError(() => this.backup.restoreSnapshot(body));
  }
}
