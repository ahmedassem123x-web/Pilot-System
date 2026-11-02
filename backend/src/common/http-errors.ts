// Pilot System v3.1 — Sprint 3. Maps Sprint 2 domain errors to HTTP
// responses WITHOUT inventing new error codes: the code and status
// come from the DomainError itself. Controllers catch DomainError and
// rethrow through this helper so every endpoint speaks the same shape:
// { code, message }. Unknown errors become 500 without leaking detail.
import { HttpException } from '@nestjs/common';
import { DomainError } from './errors';

export function toHttpError(error: unknown): HttpException {
  if (error instanceof DomainError) {
    return new HttpException(
      { code: error.code, message: error.message },
      error.status,
    );
  }
  if (error instanceof HttpException) return error;
  return new HttpException(
    { code: 'INTERNAL_ERROR', message: 'Internal error' },
    500,
  );
}

/** Wraps a controller body so DomainErrors surface with their code. */
export function mapDomainError<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    throw toHttpError(error);
  }
}

export async function mapDomainErrorAsync<T>(
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw toHttpError(error);
  }
}
