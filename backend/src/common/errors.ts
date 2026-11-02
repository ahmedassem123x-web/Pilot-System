// Pilot System v3.1 — Sprint 2. Typed domain errors. Every rejection
// carries a stable machine-readable code plus an HTTP-style status so
// Sprint 3 controllers can map it without inventing new codes.

export type DomainErrorCode =
  | 'PERMISSION_DENIED'
  | 'FORBIDDEN_TRANSITION'
  | 'SELF_TRANSITION'
  | 'GUARD_FAILED'
  | 'DUPLICATE_DEPOSIT_REFERENCE'
  | 'DUPLICATE_WHATSAPP_NUMBER'
  | 'DUPLICATE_PARTY_ROLE'
  | 'DUPLICATE_MESSAGE_ID'
  | 'DUPLICATE_EMAIL'
  | 'INVALID_PARTIES'
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'IMMUTABLE_ROW'
  | 'SEPARATION_OF_DUTIES_VIOLATION'
  | 'AMENDMENT_FORBIDDEN'
  | 'AUTH_FAILED';

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly status: number;

  constructor(code: DomainErrorCode, status: number, message: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.status = status;
  }
}

export class PermissionDeniedError extends DomainError {
  constructor(permission: string) {
    super(
      'PERMISSION_DENIED',
      403,
      `Actor lacks required permission: ${permission}`,
    );
    this.name = 'PermissionDeniedError';
  }
}

export class ForbiddenTransitionError extends DomainError {
  constructor(from: string, to: string) {
    super(
      'FORBIDDEN_TRANSITION',
      422,
      `Transition ${from} -> ${to} is not an allowed transition`,
    );
    this.name = 'ForbiddenTransitionError';
  }
}

export class GuardFailedError extends DomainError {
  constructor(message: string) {
    super('GUARD_FAILED', 422, message);
    this.name = 'GuardFailedError';
  }
}

export class ImmutableRowError extends DomainError {
  constructor(table: string) {
    super(
      'IMMUTABLE_ROW',
      409,
      `${table} rows are append-only and cannot be updated or deleted`,
    );
    this.name = 'ImmutableRowError';
  }
}

export class DuplicateError extends DomainError {
  constructor(code: DomainErrorCode, message: string) {
    super(code, 409, message);
    this.name = 'DuplicateError';
  }
}

export class NotFoundError extends DomainError {
  constructor(what: string, id: string) {
    super('NOT_FOUND', 404, `${what} not found: ${id}`);
    this.name = 'NotFoundError';
  }
}
