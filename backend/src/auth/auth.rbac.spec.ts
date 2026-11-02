// PB-23 skeleton tests: argon2id hashing, JWT, backend RBAC 403.
// Uses the IN-MEMORY TEST DOUBLE only for RBAC rows.
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from './auth.service';
import { TRANSACTION_PERMISSIONS } from './rbac.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PermissionsGuard } from './permissions.guard';
import { PERMISSION_KEY } from './require-permission.decorator';
import { createTestEnv } from '../testing/builders';

const TEST_JWT_SECRET = 'test-only-jwt-secret-for-specs';

describe('auth: argon2id + JWT', () => {
  it('hashes with argon2id and verifies the correct password only', async () => {
    const env = createTestEnv();
    const hash = await env.auth.hashPassword('test-only-password-1');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await env.auth.verifyPassword(hash, 'test-only-password-1')).toBe(true);
    expect(await env.auth.verifyPassword(hash, 'wrong-password')).toBe(false);
    expect(hash).not.toContain('test-only-password-1');
  });

  it('signs and verifies a JWT carrying staff id + permissions', () => {
    const auth = new AuthService({ jwtSecret: TEST_JWT_SECRET });
    const token = auth.signToken('staff-123', ['transactions.cancel']);
    const payload = auth.verifyToken(token);
    expect(payload.sub).toBe('staff-123');
    expect(payload.permissions).toEqual(['transactions.cancel']);
  });

  it('rejects a tampered token', () => {
    const auth = new AuthService({ jwtSecret: TEST_JWT_SECRET });
    const token = auth.signToken('staff-123', []);
    const tampered = token.slice(0, -2) + 'xx';
    expect(() => auth.verifyToken(tampered)).toThrow();
  });

  it('refuses to sign or verify when no secret is configured (no silent fallback)', () => {
    const auth = new AuthService({});
    expect(() => auth.signToken('staff-1', [])).toThrow();
    expect(() => auth.verifyToken('any-token')).toThrow();
  });

  it('JwtAuthGuard rejects a missing bearer token and attaches the actor otherwise', () => {
    const env = createTestEnv();
    const staff = env.rbac.createStaffUser(
      'guard@test.invalid',
      'test-only-hash',
      'Guard Staff',
    );
    const role = env.rbac.createRole('operator');
    const permission = env.rbac.createPermission('transactions.cancel');
    env.rbac.assignRole(staff.id, role.id);
    env.rbac.grantPermissionToRole(role.id, permission.id);
    const guard = new JwtAuthGuard(env.auth, env.rbac);
    const noTokenContext = {
      switchToHttp: () => ({
        getRequest: () => ({ headers: {} }),
      }),
    } as never;
    expect(() => guard.canActivate(noTokenContext)).toThrow(
      UnauthorizedException,
    );
    const token = env.auth.signToken(staff.id, []);
    const request: Record<string, unknown> = {
      headers: { authorization: `Bearer ${token}` },
    };
    const okContext = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as never;
    expect(guard.canActivate(okContext)).toBe(true);
    expect(
      (request.actor as { id: string; permissions: string[] }).id,
    ).toBe(staff.id);
    expect(
      (request.actor as { id: string; permissions: string[] }).permissions,
    ).toContain('transactions.cancel');
  });
});

describe('RBAC: backend 403, never UI-only', () => {
  it('grants permissions only via roles; hasPermission reflects assignments', () => {
    const env = createTestEnv();
    const staff = env.rbac.createStaffUser(
      'rbac@test.invalid',
      'test-only-hash',
      'RBAC Staff',
    );
    expect(env.rbac.hasPermission(staff.id, 'transactions.cancel')).toBe(false);
    const role = env.rbac.createRole('operator');
    const permission = env.rbac.createPermission('transactions.cancel');
    env.rbac.assignRole(staff.id, role.id);
    env.rbac.grantPermissionToRole(role.id, permission.id);
    expect(env.rbac.hasPermission(staff.id, 'transactions.cancel')).toBe(true);
    expect(env.rbac.hasPermission(staff.id, 'transactions.complete')).toBe(false);
  });

  it('PermissionsGuard throws 403 when the actor lacks the route permission', () => {
    const fakeReflector = {
      getAllAndOverride: (): string => 'transactions.complete',
    } as unknown as Reflector;
    const guard = new PermissionsGuard(fakeReflector);
    const handler = (): void => undefined;
    void PERMISSION_KEY;
    const context = {
      getHandler: () => handler,
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({
          actor: { id: 'staff-1', role: 'STAFF', permissions: ['transactions.cancel'] },
        }),
      }),
    } as never;
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    const allowedContext = {
      getHandler: () => handler,
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({
          actor: { id: 'staff-1', role: 'STAFF', permissions: ['transactions.complete'] },
        }),
      }),
    } as never;
    expect(guard.canActivate(allowedContext)).toBe(true);
  });

  it('permission catalogue covers every Guard name used by the state machine', () => {
    const expected = [
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
    ];
    for (const name of expected) {
      expect(TRANSACTION_PERMISSIONS).toContain(name);
    }
  });

  it('no staff user is seeded by the services (explicit creation only)', () => {
    const env = createTestEnv();
    expect(() => env.rbac.permissionsFor('missing-staff-id')).toThrow();
  });
});
