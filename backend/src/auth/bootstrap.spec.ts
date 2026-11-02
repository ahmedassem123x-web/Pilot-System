// Pilot System v3.1 — first-staff bootstrap rules (see bootstrap.service.ts).
// No real secret is used here: the test-only password is a local fixture
// that never leaves this spec file.
import { InMemoryStore } from '../store/in-memory.store';
import { AuthService } from './auth.service';
import { RbacService } from './rbac.service';
import { BootstrapService } from './bootstrap.service';

describe('BootstrapService', () => {
  const OLD_EMAIL = process.env.ADMIN_EMAIL;
  const OLD_PASSWORD = process.env.ADMIN_PASSWORD;

  afterEach(() => {
    if (OLD_EMAIL === undefined) delete process.env.ADMIN_EMAIL;
    else process.env.ADMIN_EMAIL = OLD_EMAIL;
    if (OLD_PASSWORD === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = OLD_PASSWORD;
  });

  function setup(): BootstrapService {
    const store = new InMemoryStore();
    const auth = new AuthService({ jwtSecret: 'test-only-secret' });
    const rbac = new RbacService(store);
    return new BootstrapService(store, auth, rbac);
  }

  it('seeds a full admin when the store is empty and env vars are set', async () => {
    process.env.ADMIN_EMAIL = 'bootstrap@example.test';
    process.env.ADMIN_PASSWORD = 'test-only-password';
    const service = setup();
    await service.onModuleInit();
    const store = (service as unknown as { store: InMemoryStore }).store;
    const staff = store.findStaffByEmail('bootstrap@example.test');
    expect(staff).toBeDefined();
    expect(staff?.password_hash).not.toBe('test-only-password');
    expect(rbacPermissions(service)).toContain('admin.manage');
    expect(rbacPermissions(service)).toContain('transactions.create');
  });

  it('seeds nothing when the env vars are absent', async () => {
    delete process.env.ADMIN_EMAIL;
    delete process.env.ADMIN_PASSWORD;
    const service = setup();
    await service.onModuleInit();
    const store = (service as unknown as { store: InMemoryStore }).store;
    expect(store.exportSnapshot().staffUsers).toHaveLength(0);
  });

  it('seeds nothing when a staff user already exists', async () => {
    process.env.ADMIN_EMAIL = 'bootstrap@example.test';
    process.env.ADMIN_PASSWORD = 'test-only-password';
    const service = setup();
    await service.onModuleInit();
    await service.onModuleInit();
    const store = (service as unknown as { store: InMemoryStore }).store;
    expect(store.exportSnapshot().staffUsers).toHaveLength(1);
  });

  function rbacPermissions(service: BootstrapService): string[] {
    const store = (service as unknown as { store: InMemoryStore }).store;
    const rbac = new RbacService(store);
    const staff = store.findStaffByEmail('bootstrap@example.test');
    if (!staff) return [];
    return rbac.permissionsFor(staff.id);
  }
});
