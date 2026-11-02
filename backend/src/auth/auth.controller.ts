// Pilot System v3.1 — Sprint 3 (PB-23). Staff authentication HTTP
// surface. Passwords are verified against argon2id hashes only; no
// plaintext password is ever stored, logged, or returned. Tokens are
// JWT (8h default, see auth.service.ts) and carry no secret value.
import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RbacService } from './rbac.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { InMemoryStore } from '../store/in-memory.store';
import { mapDomainErrorAsync } from '../common/http-errors';

@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly rbac: RbacService,
    private readonly store: InMemoryStore,
  ) {}

  @Post('login')
  async login(
    @Body() body: { email: string; password: string },
  ): Promise<Record<string, unknown>> {
    return mapDomainErrorAsync(async () => {
      const staff = this.store.findStaffByEmail(body.email);
      if (!staff || !staff.is_active) {
        throw new UnauthorizedException('Invalid email or password');
      }
      const ok = await this.auth.verifyPassword(
        staff.password_hash,
        body.password,
      );
      if (!ok) {
        throw new UnauthorizedException('Invalid email or password');
      }
      const permissions = this.rbac.permissionsFor(staff.id);
      const token = this.auth.signToken(staff.id, permissions);
      return {
        token,
        staff_id: staff.id,
        display_name: staff.display_name,
        permissions,
      };
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(
    @Req()
    req: {
      actor?: { id: string; role: string; permissions: string[] };
    },
  ): Record<string, unknown> {
    return {
      staff_id: req.actor?.id ?? null,
      role: req.actor?.role ?? null,
      permissions: req.actor?.permissions ?? [],
    };
  }
}
