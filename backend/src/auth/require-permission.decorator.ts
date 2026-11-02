// Pilot System v3.1 — Sprint 2. Route metadata for PermissionsGuard.
// Sprint 3 controllers annotate handlers with the permission their
// Guard requires; the guard enforces it in the backend (403).
import { SetMetadata } from '@nestjs/common';

export const PERMISSION_KEY = 'pilot_required_permission';

export const RequirePermission = (permission: string): MethodDecorator =>
  SetMetadata(PERMISSION_KEY, permission);
