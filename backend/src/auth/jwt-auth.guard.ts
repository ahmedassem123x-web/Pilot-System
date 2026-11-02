// Pilot System v3.1 — Sprint 2. JWT authentication guard for Sprint 3
// HTTP controllers. Verifies the Bearer token with AuthService, loads
// effective permissions with RbacService, and attaches the actor to
// the request for PermissionsGuard. No token => 401. No bypass path.
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RbacService } from './rbac.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly rbac: RbacService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      actor?: { id: string; role: string; permissions: string[] };
    }>();
    const header = request.headers.authorization ?? '';
    const match = /^Bearer\s+(.+)$/.exec(header);
    if (!match) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const payload = this.auth.verifyToken(match[1]);
    request.actor = {
      id: payload.sub,
      role: 'STAFF',
      permissions: this.rbac.permissionsFor(payload.sub),
    };
    return true;
  }
}
