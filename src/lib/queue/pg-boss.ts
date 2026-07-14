/**
 * Postgres Job Queue — Serverless-Compatible Implementation
 * =========================================================
 * A lightweight, pg-boss-compatible job queue built directly on Supabase/Postgres.
 * No persistent Node.js process required — works via polling in serverless functions.
 *
 * Features:
 * - Atomic fetch-and-lock via PostgreSQL `SELECT ... FOR UPDATE SKIP LOCKED`
 * - Automatic retries with exponential backoff
 * - Priority queue support
 * - Scheduled/delayed job execution
 * - Compatible with both Next.js API routes and Cloudflare Workers
 *
 * Table dependency: `public.job_queue` (created by supabase/migrations/003_chief.sql)
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Types & Schemas
// ---------------------------------------------------------------------------

export const JobStateSchema = z.enum(['pending', 'active', 'completed', 'failed', 'cancelled', 'retry']);
export type JobState = z.infer<typeof JobStateSchema>;

export const JobSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  data: z.record(z.unknown()).default({}),
  state: JobStateSchema,
  retry_count: z.number().int().default(0),
  max_retries: z.number().int().default(3),
  priority: z.number().int().default(0),
  output: z.record(z.unknown()).nullable(),
  error_message: z.string().nullable(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  scheduled_for: z.string(),
  created_at: z.string(),
});

export type Job = z.infer<typeof JobSchema>;

export interface QueueConfig {
  supabaseUrl: string;
  supabaseServiceKey: string;
}

export interface SendOptions {
  name: string;
  data?: Record<string, unknown>;
  scheduledFor?: Date;
  priority?: number;
  maxRetries?: number;
}

export interface WorkOptions {
  batchSize?: number;
  pollingIntervalMs?: number;
}

export type JobHandler = (job: Job) => Promise<Record<string, unknown>>;

// ---------------------------------------------------------------------------
// Supabase REST API helpers
// ---------------------------------------------------------------------------

function headers(cfg: QueueConfig): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'apikey': cfg.supabaseServiceKey,
    'Authorization': `Bearer ${cfg.supabaseServiceKey}`,
  };
}

// ---------------------------------------------------------------------------
// Queue class
// ---------------------------------------------------------------------------

export class PgBossQueue {
  constructor(private cfg: QueueConfig) {}

  /**
   * Enqueue a new job.
   */
  async send(opts: SendOptions): Promise<{ id: string }> {
    const payload = {
      name: opts.name,
      data: opts.data || {},
      state: 'pending',
      scheduled_for: opts.scheduledFor?.toISOString() || new Date().toISOString(),
      priority: opts.priority ?? 0,
      max_retries: opts.maxRetries ?? 3,
    };

    const res = await fetch(`${this.cfg.supabaseUrl}/rest/v1/job_queue`, {
      method: 'POST',
      headers: {
        ...headers(this.cfg),
        'Prefer': 'return=representation',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`PgBossQueue.send failed: ${res.status} ${text}`);
    }

    const rows = (await res.json()) as Array<{ id: string }>;
    return { id: rows[0].id };
  }

  /**
   * Send multiple jobs in one batch.
   */
  async sendBatch(opts: SendOptions[]): Promise<{ ids: string[] }> {
    const payloads = opts.map((o) => ({
      name: o.name,
      data: o.data || {},
      state: 'pending',
      scheduled_for: o.scheduledFor?.toISOString() || new Date().toISOString(),
      priority: o.priority ?? 0,
      max_retries: o.maxRetries ?? 3,
    }));

    const res = await fetch(`${this.cfg.supabaseUrl}/rest/v1/job_queue`, {
      method: 'POST',
      headers: {
        ...headers(this.cfg),
        'Prefer': 'return=representation',
      },
      body: JSON.stringify(payloads),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`PgBossQueue.sendBatch failed: ${res.status} ${text}`);
    }

    const rows = (await res.json()) as Array<{ id: string }>;
    return { ids: rows.map((r) => r.id) };
  }

  /**
   * Fetch and lock the next available job for a given queue name.
   * Uses the `fetch_and_lock_job` PostgreSQL function for atomicity.
   */
  async fetch(name: string): Promise<Job | null> {
    const res = await fetch(`${this.cfg.supabaseUrl}/rest/v1/rpc/fetch_and_lock_job`, {
      method: 'POST',
      headers: headers(this.cfg),
      body: JSON.stringify({ job_name: name }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`PgBossQueue.fetch failed: ${res.status} ${text}`);
    }

    const rows = (await res.json()) as unknown[];
    if (rows.length === 0) return null;

    return JobSchema.parse(rows[0]);
  }

  /**
   * Mark a job as completed with optional output payload.
   */
  async complete(jobId: string, output?: Record<string, unknown>): Promise<void> {
    const res = await fetch(`${this.cfg.supabaseUrl}/rest/v1/rpc/complete_job`, {
      method: 'POST',
      headers: headers(this.cfg),
      body: JSON.stringify({
        job_id: jobId,
        job_output: output || {},
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`PgBossQueue.complete failed: ${res.status} ${text}`);
    }
  }

  /**
   * Mark a job as failed. Automatically retries if under max_retries.
   */
  async fail(jobId: string, errorMessage: string): Promise<void> {
    const res = await fetch(`${this.cfg.supabaseUrl}/rest/v1/rpc/fail_job`, {
      method: 'POST',
      headers: headers(this.cfg),
      body: JSON.stringify({
        job_id: jobId,
        err_message: errorMessage,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`PgBossQueue.fail failed: ${res.status} ${text}`);
    }
  }

  /**
   * Cancel a pending job.
   */
  async cancel(jobId: string): Promise<void> {
    const res = await fetch(`${this.cfg.supabaseUrl}/rest/v1/job_queue?id=eq.${jobId}`, {
      method: 'PATCH',
      headers: headers(this.cfg),
      body: JSON.stringify({ state: 'cancelled', completed_at: new Date().toISOString() }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`PgBossQueue.cancel failed: ${res.status} ${text}`);
    }
  }

  /**
   * Work a single job with the provided handler.
   * Returns true if a job was processed, false if queue empty.
   */
  async work(name: string, handler: JobHandler): Promise<{ processed: boolean; job?: Job }> {
    const job = await this.fetch(name);
    if (!job) return { processed: false };

    try {
      const output = await handler(job);
      await this.complete(job.id, output);
      return { processed: true, job };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.fail(job.id, msg);
      return { processed: true, job };
    }
  }

  /**
   * Poll and process jobs continuously (for long-running processes like local dev).
   * In serverless, prefer calling `work()` from a scheduled function instead.
   */
  async startWorker(name: string, handler: JobHandler, opts?: WorkOptions): Promise<() => void> {
    const interval = opts?.pollingIntervalMs ?? 5000;
    let active = true;

    const tick = async () => {
      if (!active) return;
      try {
        const result = await this.work(name, handler);
        if (!result.processed) {
          // Queue empty; wait before next poll
          setTimeout(tick, interval);
        } else {
          // Job processed; immediately try next
          setImmediate(tick);
        }
      } catch {
        setTimeout(tick, interval);
      }
    };

    tick();

    return () => {
      active = false;
    };
  }

  /**
   * Get queue statistics by state.
   */
  async stats(): Promise<Record<string, number>> {
    const states: JobState[] = ['pending', 'active', 'completed', 'failed', 'cancelled'];
    const result: Record<string, number> = {};

    await Promise.all(
      states.map(async (state) => {
        const url = `${this.cfg.supabaseUrl}/rest/v1/job_queue?state=eq.${state}&select=id`;
        const res = await fetch(url, {
          headers: {
            ...headers(this.cfg),
            'Prefer': 'count=exact',
            'Range': '0-0',
          },
        });
        const range = res.headers.get('content-range');
        if (range) {
          const match = range.match(/\/(\d+)$/);
          result[state] = match ? parseInt(match[1], 10) : 0;
        } else {
          result[state] = 0;
        }
      })
    );

    return result;
  }

  /**
   * List jobs with optional filtering.
   */
  async list(opts?: {
    name?: string;
    state?: JobState;
    limit?: number;
    offset?: number;
  }): Promise<Job[]> {
    const params = new URLSearchParams();
    params.set('select', '*');
    params.set('order', 'created_at.desc');
    params.set('limit', String(opts?.limit || 50));
    params.set('offset', String(opts?.offset || 0));

    if (opts?.name) params.set('name', `eq.${opts.name}`);
    if (opts?.state) params.set('state', `eq.${opts.state}`);

    const res = await fetch(`${this.cfg.supabaseUrl}/rest/v1/job_queue?${params.toString()}`, {
      headers: headers(this.cfg),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`PgBossQueue.list failed: ${res.status} ${text}`);
    }

    const rows = (await res.json()) as unknown[];
    return rows.map((r) => JobSchema.parse(r));
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createQueue(cfg: QueueConfig): PgBossQueue {
  return new PgBossQueue(cfg);
}
