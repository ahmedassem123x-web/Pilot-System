// Pilot System v3.1 — Sprint 2 (PB-23 skeleton, CORE PROMPT §14.1).
// Staff authentication: passwords stored ONLY as argon2id hashes,
// sessions as JWT. No hard-coded secret, no fallback secret, no demo
// credential anywhere: the secret arrives ONLY via the JWT_SECRET
// environment variable name (see auth.module.ts) or an explicit
// constructor option (tests pass their own test-only value). If no
// secret is configured, sign/verify throw instead of silently working.
import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import * as jwt from 'jsonwebtoken';
import { DomainError } from '../common/errors';

export interface JwtPayload {
  sub: string;
  permissions: string[];
  iat?: number;
  exp?: number;
}

export interface AuthServiceOptions {
  jwtSecret?: string;
  jwtExpiresInSeconds?: number;
}

@Injectable()
export class AuthService {
  private readonly jwtSecret?: string;
  private readonly jwtExpiresInSeconds: number;

  constructor(options: AuthServiceOptions = {}) {
    this.jwtSecret = options.jwtSecret;
    this.jwtExpiresInSeconds = options.jwtExpiresInSeconds ?? 8 * 60 * 60;
  }

  /** Hash a staff password with argon2id. Never store the plaintext. */
  async hashPassword(plaintext: string): Promise<string> {
    if (!plaintext) {
      throw new DomainError('INVALID_INPUT', 422, 'password is required');
    }
    return argon2.hash(plaintext, { type: argon2.argon2id });
  }

  async verifyPassword(hash: string, plaintext: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plaintext);
    } catch {
      return false;
    }
  }

  signToken(staffUserId: string, permissions: string[]): string {
    if (!this.jwtSecret) {
      throw new DomainError(
        'AUTH_FAILED',
        500,
        'JWT secret is not configured (environment variable name JWT_SECRET)',
      );
    }
    return jwt.sign(
      { sub: staffUserId, permissions },
      this.jwtSecret,
      { expiresIn: this.jwtExpiresInSeconds },
    );
  }

  verifyToken(token: string): JwtPayload {
    if (!this.jwtSecret) {
      throw new DomainError(
        'AUTH_FAILED',
        500,
        'JWT secret is not configured (environment variable name JWT_SECRET)',
      );
    }
    try {
      return jwt.verify(token, this.jwtSecret) as JwtPayload;
    } catch {
      throw new DomainError('AUTH_FAILED', 401, 'Invalid or expired token');
    }
  }
}
