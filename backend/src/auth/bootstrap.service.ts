// Pilot System v3.1 — first-staff bootstrap.
//
// PROBLEM IT SOLVES: a fresh store contains no staff user, and creating
// staff requires a JWT with `admin.manage` — so a fresh deployment could
// never be signed into at all. This service breaks that deadlock ONLY
// when all of these hold:
//   1. the store currently has no staff user, and
//   2. ADMIN_EMAIL and ADMIN_PASSWORD are set in the environment.
//
// The password value is NEVER stored, logged, or returned: it is hashed
// with argon2id at boot and then forgotten. The values live only in the
// hosting panel (Render environment variables), never in the repo, in
// chat, or in any file. If the variables are absent, nothing is seeded
// and sign-in stays impossible until an operator sets them — that is
// the safe default, not a demo credential.
//
// The bootstrapped account gets a full admin role (every transaction
// permission plus `admin.manage`) so the first operator can create the
// real staff accounts and then this account can be deactivated. On a
// restart the store is empty again (in-memory demo store), so the same
// environment variables re-seed the same account — consistent, and
// still gated on the variables being present.
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RbacService, TRANSACTION_PERMISSIONS } from './rbac.service';
import { InMemoryStore } from '../store/in-memory.store';

@Injectable()
export class BootstrapService implements OnModuleInit {
  private readonly logger = new Logger(BootstrapService.name);

  constructor(
    private readonly store: InMemoryStore,
    private readonly auth: AuthService,
    private readonly rbac: RbacService,
  ) {}

  async onModuleInit(): Promise<void> {
    const email = process.env.ADMIN_EMAIL?.trim();
    const password = process.env.ADMIN_PASSWORD;
    if (!email || !password) return;
    if (this.store.exportSnapshot().staffUsers.length > 0) return;

    const hash = await this.auth.hashPassword(password);
    const staff = this.rbac.createStaffUser(email, hash, 'Bootstrap admin');
    const role = this.rbac.createRole(
      'bootstrap-admin',
      'First operator account, seeded from environment at first boot.',
    );
    const permissions = this.rbac.ensurePermissions([
      ...TRANSACTION_PERMISSIONS,
      'admin.manage',
    ]);
    for (const permission of permissions) {
      this.rbac.grantPermissionToRole(role.id, permission.id);
    }
    this.rbac.assignRole(staff.id, role.id);
    // Deliberately no email or password in the log line.
    this.logger.log('First staff account bootstrapped from environment.');
  }
}
