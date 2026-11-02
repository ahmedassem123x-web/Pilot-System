// Pilot System v3.1 — Sprint 2. UUID generation via Node's built-in
// crypto.randomUUID: permanent, never reused, no extra dependency.
import { randomUUID } from 'node:crypto';

export function newId(): string {
  return randomUUID();
}

export function newCorrelationId(): string {
  return randomUUID();
}
