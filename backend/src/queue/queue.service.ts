// Pilot System v3.1 — Sprint 3 (PB-24). Asynchronous job queue.
//
// TRANSPORT STATUS — READ THIS FIRST: this is the IN-MEMORY / TEST
// transport. It runs in-process, holds jobs in memory, and is lost on
// restart. The production transport (a Redis-backed queue, per the
// v3.1 stack) is NOT running in this environment — no Redis server is
// available here — so live Redis behaviour is UNVERIFIED and belongs
// to Sprint 5, where this service is swapped for the Redis-backed
// implementation behind the same enqueue/process shape. Do NOT present
// results obtained through this transport as Redis-backed results.
//
// ALLOWED JOB KINDS — CLOSED LIST, ENFORCED IN CODE:
//   whatsapp.inbound.process — finish handling a verified webhook
//     event asynchronously. The handler NEVER performs a state
//     transition, a financial step, or an acceptance decision; the
//     webhook itself already created the MessageLog row, and the job
//     only records that async processing ran.
//   reminder.send — a HUMAN reminder to staff or a party (a note that
//     a response is awaited). It performs no transition and implies
//     none.
//   escalation.notify — a HUMAN escalation to operations staff. It
//     performs no transition and implies none.
//
// Anything else is rejected at enqueue time. There is deliberately NO
// timer, scheduler, or delayed-execution mechanism in this module:
// retries happen only when processPending is called again (by the
// caller, explicitly), a failed job is retried at most MAX_ATTEMPTS
// times and then marked failed, and no job ever "fires later" on its
// own. A job that accepted, settled, closed, refunded, or funded
// anything would be a v3.1 violation — the closed job list plus the
// negative tests are the proof that no such job exists.
import { Injectable } from '@nestjs/common';
import { DomainError } from '../common/errors';
import { newId } from '../common/ids';

export const ALLOWED_JOB_NAMES = [
  'whatsapp.inbound.process',
  'reminder.send',
  'escalation.notify',
] as const;

export type AllowedJobName = (typeof ALLOWED_JOB_NAMES)[number];

export const MAX_ATTEMPTS = 3;

export interface QueuedJob {
  id: string;
  name: AllowedJobName;
  payload: Record<string, unknown>;
  attempts: number;
  status: 'queued' | 'done' | 'failed';
  lastError: string | null;
  createdAt: Date;
}

export type JobHandler = (job: QueuedJob) => void | Promise<void>;

@Injectable()
export class QueueService {
  private jobs: QueuedJob[] = [];

  enqueue(name: string, payload: Record<string, unknown>): QueuedJob {
    if (!(ALLOWED_JOB_NAMES as readonly string[]).includes(name)) {
      throw new DomainError(
        'INVALID_INPUT',
        422,
        `Job name is not allowed: ${name}. Allowed jobs are reminders, escalations, and async webhook processing only — no job may perform a financial or acceptance decision.`,
      );
    }
    const job: QueuedJob = {
      id: newId(),
      name: name as AllowedJobName,
      payload,
      attempts: 0,
      status: 'queued',
      lastError: null,
      createdAt: new Date(),
    };
    this.jobs.push(job);
    return job;
  }

  /** Jobs still waiting for an explicit processPending call. */
  pending(): QueuedJob[] {
    return this.jobs.filter((job) => job.status === 'queued');
  }

  allJobs(): QueuedJob[] {
    return [...this.jobs];
  }

  /**
   * Runs each queued job through its handler, synchronously in call
   * order. A throwing handler increments attempts; after MAX_ATTEMPTS
   * the job is marked failed and never retried again. This method is
   * the ONLY retry mechanism — there is no background retry loop.
   */
  async processPending(
    handlers: Partial<Record<AllowedJobName, JobHandler>>,
  ): Promise<QueuedJob[]> {
    const processed: QueuedJob[] = [];
    for (const job of this.pending()) {
      const handler = handlers[job.name];
      job.attempts += 1;
      try {
        if (handler) await handler(job);
        job.status = 'done';
      } catch (error) {
        job.lastError = error instanceof Error ? error.message : 'Job failed';
        job.status = job.attempts >= MAX_ATTEMPTS ? 'failed' : 'queued';
      }
      processed.push(job);
    }
    return processed;
  }
}
