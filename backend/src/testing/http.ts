// Pilot System v3.1 — Sprint 3 TEST-ONLY HTTP harness.
// Builds the real Nest application (AppModule) over a FRESH
// InMemoryStore test double (NOT Prisma, NOT PostgreSQL — see
// in-memory.store.ts header) and mints staff JWTs by seeding the
// store directly. Test-only secrets: these values exist ONLY in this
// file and in specs, never in non-spec source, and never outside
// tests. The JwtAuthGuard loads permissions from the store, so a
// minted token's power is exactly the permissions seeded for that
// staff member — which is what the 403 tests exercise.
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../app.module';
import { InMemoryStore } from '../store/in-memory.store';
import { AuthService } from '../auth/auth.service';
import { ALL_PERMISSIONS } from './builders';

export const TEST_JWT_SECRET = 'test-only-jwt-secret-sprint3';
export const TEST_APP_SECRET = 'test-only-whatsapp-app-secret-sprint3';
export const TEST_VERIFY_TOKEN = 'test-only-verify-token-sprint3';
export const TEST_FILE_SECRET = 'test-only-file-link-secret-sprint3';

let staffCounter = 0;

export interface HttpEnv {
  app: INestApplication;
  store: InMemoryStore;
  auth: AuthService;
  /** Creates a staff member with exactly these permissions; returns a bearer token. */
  tokenFor: (permissions: string[]) => { token: string; staffId: string };
  /** Staff member with every transaction/admin/audit permission. */
  fullToken: () => { token: string; staffId: string };
  close: () => Promise<void>;
}

export async function createHttpEnv(): Promise<HttpEnv> {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  process.env.WHATSAPP_APP_SECRET = TEST_APP_SECRET;
  process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = TEST_VERIFY_TOKEN;
  process.env.WHATSAPP_VERIFY_TOKEN = TEST_VERIFY_TOKEN;
  process.env.FILE_LINK_SECRET = TEST_FILE_SECRET;

  const store = new InMemoryStore();
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(InMemoryStore)
    .useValue(store)
    .compile();

  const app = moduleFixture.createNestApplication({ rawBody: true });
  await app.init();
  const auth = new AuthService({ jwtSecret: TEST_JWT_SECRET });

  const tokenFor = (permissions: string[]) => {
    staffCounter += 1;
    const staff = store.createStaffUser({
      email: `http-staff-${staffCounter}@test.invalid`,
      password_hash: 'test-only-unverified-hash',
      display_name: `HTTP Staff ${staffCounter}`,
      is_active: true,
    });
    const role = store.createRole(`http-role-${staffCounter}`);
    for (const name of permissions) {
      const permission = store.createPermission(name);
      store.assignPermissionToRole(role.id, permission.id);
    }
    store.assignRoleToStaff(staff.id, role.id);
    return { token: auth.signToken(staff.id, permissions), staffId: staff.id };
  };

  return {
    app,
    store,
    auth,
    tokenFor,
    fullToken: () => tokenFor([...ALL_PERMISSIONS, 'admin.manage']),
    close: () => app.close(),
  };
}
