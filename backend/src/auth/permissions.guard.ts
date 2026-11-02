// Pilot System v3.1 — Sprint 2. Backend permission guard for Sprint 3
// HTTP controllers. It reads the actor attached to the request by
// JwtAuthGuard (id, role, effective permissions) and the permission
// required by the route. Missing permission => 403 ForbiddenException.
// The service-layer Guards in transactions.service.ts enforce the same
// permissions independently, so a controller without this guard cannot
// bypass them.
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSION_KEY } from './require-permission.decorator';

export interface RequestActor {
  id: string;
  role: string;
  permissions: string[];
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;
    const request = context.switchToHttp().getRequest<{
      actor?: RequestActor;
    }>();
    const actor = request.actor;
    if (!actor || !actor.permissions.includes(required)) {
      throw new ForbiddenException(`Actor lacks required permission: ${required}`);
    }
    return true;
  }
}
