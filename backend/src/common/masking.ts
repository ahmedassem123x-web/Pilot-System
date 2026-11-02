// Pilot System v3.1 — Sprint 3 (PB-25). Sensitive-data masking for
// DISPLAY and LOGGING surfaces. Staff-only operational views (audit
// view, coordination records) still show full references because staff
// need them to verify against the institution — masking there would
// break verification. Masking applies where an identifier is shown
// outside that verification need: file metadata, message lists, and
// any logged output. Services in this codebase never log secret,
// token, phone-number or reference VALUES; this helper is the one
// place a display value is reduced, so the rule is reviewable.
export function maskMiddle(value: string, visibleStart = 3, visibleEnd = 2): string {
  if (!value) return value;
  if (value.length <= visibleStart + visibleEnd + 1) return '***';
  return (
    value.slice(0, visibleStart) +
    '*'.repeat(value.length - visibleStart - visibleEnd) +
    value.slice(value.length - visibleEnd)
  );
}

export function maskIdentifier(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return value;
  return maskMiddle(value);
}

/** Masks phone-like and email-like identifiers in a display string. */
export function maskContact(value: string): string {
  if (value.includes('@')) {
    const [local, domain] = value.split('@');
    if (!domain) return maskMiddle(value);
    return `${maskMiddle(local, 1, 1)}@${domain}`;
  }
  return maskMiddle(value);
}

const SENSITIVE_KEYS = ['phone', 'whatsapp', 'email', 'token', 'secret', 'password'];

/**
 * Returns a copy of an object with sensitive-keyed string values
 * masked. Used for file metadata and message-list display payloads.
 * Audit details are NOT passed through this function (see header).
 */
export function maskDisplayObject(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (
      typeof value === 'string' &&
      SENSITIVE_KEYS.some((k) => key.toLowerCase().includes(k))
    ) {
      out[key] = maskMiddle(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}
