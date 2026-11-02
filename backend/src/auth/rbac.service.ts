// Pilot System v3.1 — Sprint 2 (PB-23 skeleton). Staff RBAC data:
// StaffUser / Role / Permission, enforced in the BACKEND (403 on
// violation), never only in the UI. Permission names are the Guard
// names from docs/transition-matrix.md §3. No role, user or permission
// is seeded here: Sprint 3 administration creates them explicitly.
import { Injectable } from '@nestjs/common';
import type { Role, Permission, StaffUser, Store } from '../store/repository';
import { NotFoundError } from '../common/errors';

export const TRANSACTION_PERMISSIONS = [
  'transactions.create',
  'transactions.submit_review',
  'transactions.accept_contract',
  'transactions.request_amendment',
  'transactions.issue_voucher',
  'transactions.confirm_funding',
  'transactions.start_fulfilment',
  'transactions.record_delivery',
  'transactions.record_receipt',
  'transactions.prepare_settlement',
  'transactions.record_settlement',
  'transactions.open_dispute',
  'transactions.resolve_dispute',
  'transactions.record_refund',
  'transactions.complete',
  'transactions.cancel',
  'audit.view',
  'users.approve',
  'users.suspend',
] as const;

@Injectable()
export class RbacService {
  constructor(private readonly store: Store) {}

  createStaffUser(
    email: string,
    passwordHash: string,
    displayName?: string | null,
  ): StaffUser {
    return this.store.createStaffUser({
      email,
      password_hash: passwordHash,
      display_name: displayName ?? null,
      is_active: true,
    });
  }

  createRole(name: string, description?: string | null): Role {
    return this.store.createRole(name, description ?? null);
  }

  createPermission(name: string, description?: string | null): Permission {
    return this.store.createPermission(name, description ?? null);
  }

  assignRole(staffUserId: string, roleId: string): void {
    this.store.assignRoleToStaff(staffUserId, roleId);
  }

  grantPermissionToRole(roleId: string, permissionId: string): void {
    this.store.assignPermissionToRole(roleId, permissionId);
  }

  /** Effective permissions for a staff member, via their roles. */
  permissionsFor(staffUserId: string): string[] {
    if (!this.store.findStaffById(staffUserId)) {
      throw new NotFoundError('StaffUser', staffUserId);
    }
    return this.store.staffPermissions(staffUserId);
  }

  hasPermission(staffUserId: string, permission: string): boolean {
    return this.permissionsFor(staffUserId).includes(permission);
  }

  /** Ensure every named permission exists; returns the rows. */
  ensurePermissions(names: readonly string[]): Permission[] {
    return names.map((name) => this.store.createPermission(name));
  }
}
