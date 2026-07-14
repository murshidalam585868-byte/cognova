/**
 * Chief of Staff — Cloudflare Worker Entry Point
 * ==============================================
 * Scheduled intelligence pipeline for Cognova AI.
 * Domain: brain.mr-imperfect.online
 *
 * Triggers:
 *   - 0 * * * *     → RSS ingestion (hourly)
 *   - 0 7 * * *     → Daily digest generation (07:00 UTC)
 *
 * Endpoints:
 *   GET  /           → Health check
 *   POST /ingest     → Manual RSS ingestion trigger
 *   POST /digest     → Manual digest generation trigger
 *   POST /event      → On-demand event digest
 *   GET  /stats      → Pipeline statistics
 *
 * Environment:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY must be set as secrets.
 *   DOMAIN is configured in wrangler.toml vars.
 */

import { z } from 'zod';
import { ingestAllFeeds } from './rss';
import { generateDailyDigests, generateEventDigest } from './digest';
import type { SupabaseConfig } from './rss';

// ---------------------------------------------------------------------------
// Domain constants
// ---------------------------------------------------------------------------

const DOMAIN = 'brain.mr-imperfect.online';
const APP_URL = 'https://brain.mr-imperfect.online';
const API_BASE = 'https://brain.mr-imperfect.online/api';
const ALLOWED_ORIGINS = [
  'https://brain.mr-imperfect.online',
  'https://mr-imperfect.online',
  'https://www.mr-imperfect.online',
  'https://staging.brain.mr-imperfect.online',
];

// ---------------------------------------------------------------------------
// Environment validation
// ---------------------------------------------------------------------------

const EnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_KEY: z.string().min(1),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  SLACK_WEBHOOK: z.string().url().optional(),
  DOMAIN: z.string().default(DOMAIN),
  APP_URL: z.string().url().default(APP_URL),
});

type Env = z.infer<typeof EnvSchema>;

function parseEnv(env: Record<string, unknown>): Env {
  return EnvSchema.parse({
    SUPABASE_URL: env.SUPABASE_URL,
    SUPABASE_SERVICE_KEY: env.SUPABASE_SERVICE_KEY,
    LOG_LEVEL: env.LOG_LEVEL || 'info',
    SLACK_WEBHOOK: env.SLACK_WEBHOOK || undefined,
    DOMAIN: env.DOMAIN || DOMAIN,
    APP_URL: env.APP_URL || APP_URL,
  });
}

// ---------------------------------------------------------------------------
// Logger (Worker-friendly: no Node streams)
// ---------------------------------------------------------------------------

class WorkerLogger {
  constructor(private level: Env['LOG_LEVEL']) {}

  private shouldLog(level: Env['LOG_LEVEL']): boolean {
    const levels = { debug: 0, info: 1, warn: 2, error: 3 };
    return levels[level] >= levels[this.level];
  }

  debug(msg: string, meta?: Record<string, unknown>) {
    if (this.shouldLog('debug')) console.log(JSON.stringify({ level: 'debug', message: msg, ...meta }));
  }
  info(msg: string, meta?: Record<string, unknown>) {
    if (this.shouldLog('info')) console.log(JSON.stringify({ level: 'info', message: msg, ...meta }));
  }
  warn(msg: string, meta?: Record<string, unknown>) {
    if (this.shouldLog('warn')) console.log(JSON.stringify({ level: 'warn', message: msg, ...meta }));
  }
  error(msg: string, meta?: Record<string, unknown>) {
    if (this.shouldLog('error')) console.log(JSON.stringify({ level: 'error', message: msg, ...meta }));
  }
}

// ---------------------------------------------------------------------------
// CORS helper
// ---------------------------------------------------------------------------

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(body: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extraHeaders,
  };
  return new Response(JSON.stringify(body), { status, headers });
}

// ---------------------------------------------------------------------------
// Slack notification helper
// ---------------------------------------------------------------------------

async function notifySlack(webhook: string | undefined, text: string): Promise<void> {
  if (!webhook) return;
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  } catch {
    // Best-effort; don't fail pipeline on Slack errors
  }
}

// ---------------------------------------------------------------------------
// Durable Object for singleton digest coordination
// ---------------------------------------------------------------------------

export class DigestCoordinator {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/lock') {
      const existing = await this.state.storage.get<string>('digest_lock');
      if (existing) {
        return new Response(JSON.stringify({ locked: true, since: existing }), { status: 423 });
      }
      await this.state.storage.put('digest_lock', new Date().toISOString());
      return new Response(JSON.stringify({ locked: true }), { status: 200 });
    }
    if (url.pathname === '/unlock') {
      await this.state.storage.delete('digest_lock');
      return new Response(JSON.stringify({ unlocked: true }), { status: 200 });
    }
    return new Response('Not found', { status: 404 });
  }
}

// ---------------------------------------------------------------------------
// Scheduled event handler
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Record<string, unknown>, ctx: ExecutionContext): Promise<Response> {
    const start = Date.now();
    const parsedEnv = parseEnv(env);
    const log = new WorkerLogger(parsedEnv.LOG_LEVEL);
    const cfg: SupabaseConfig = {
      url: parsedEnv.SUPABASE_URL,
      serviceKey: parsedEnv.SUPABASE_SERVICE_KEY,
    };
    const cors = corsHeaders(request);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    const method = request.method;

    // ---- Health check ----
    if (url.pathname === '/' && method === 'GET') {
      return jsonResponse(
        {
          status: 'ok',
          service: 'chief-of-staff',
          version: '0.3.0',
          domain: parsedEnv.DOMAIN,
          appUrl: parsedEnv.APP_URL,
          timestamp: new Date().toISOString(),
        },
        200,
        cors
      );
    }

    // ---- Manual RSS ingestion ----
    if (url.pathname === '/ingest' && method === 'POST') {
      try {
        const results = await ingestAllFeeds(cfg);
        const totalInserted = results.reduce((sum, r) => sum + r.inserted, 0);
        const errors = results.flatMap((r) => r.errors);

        log.info('Manual ingest completed', { totalInserted, sourceCount: results.length, errors: errors.length });

        return jsonResponse(
          {
            success: true,
            totalInserted,
            sources: results.map((r) => ({
              name: r.sourceName,
              fetched: r.fetched,
              inserted: r.inserted,
              notModified: r.notModified,
            })),
            errors,
          },
          200,
          cors
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error('Manual ingest failed', { error: msg });
        return jsonResponse({ success: false, error: msg }, 500, cors);
      }
    }

    // ---- Manual digest generation ----
    if (url.pathname === '/digest' && method === 'POST') {
      try {
        const body = await request.json().catch(() => ({})) as Record<string, unknown>;
        const dryRun = body.dryRun === true;
        const lookback = typeof body.lookbackHours === 'number' ? body.lookbackHours : 24;

        const result = await generateDailyDigests(cfg, { lookbackHours: lookback, dryRun });
        log.info('Manual digest generation completed', { digests: result.digestsCreated, jobs: result.jobsEnqueued });

        return jsonResponse({ success: true, dryRun, ...result }, 200, cors);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error('Manual digest generation failed', { error: msg });
        return jsonResponse({ success: false, error: msg }, 500, cors);
      }
    }

    // ---- On-demand event digest ----
    if (url.pathname === '/event' && method === 'POST') {
      try {
        const body = await request.json() as {
          userId?: string;
          title?: string;
          keywords?: string[];
          lookbackHours?: number;
          channels?: string[];
        };

        if (!body.userId || !body.title || !body.keywords || body.keywords.length === 0) {
          return jsonResponse({ success: false, error: 'Missing userId, title, or keywords' }, 400, cors);
        }

        const result = await generateEventDigest(cfg, {
          userId: body.userId,
          title: body.title,
          keywords: body.keywords,
          lookbackHours: body.lookbackHours,
          channels: body.channels,
        });

        if (result.error) {
          return jsonResponse({ success: false, error: result.error }, 422, cors);
        }

        return jsonResponse({ success: true, digestId: result.digestId }, 200, cors);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error('Event digest generation failed', { error: msg });
        return jsonResponse({ success: false, error: msg }, 500, cors);
      }
    }

    // ---- Pipeline statistics ----
    if (url.pathname === '/stats' && method === 'GET') {
      try {
        const [newsCount, digestCount, queueStats] = await Promise.all([
          fetchCount(cfg, 'news_items'),
          fetchCount(cfg, 'digests'),
          fetchQueueStats(cfg),
        ]);

        return jsonResponse(
          {
            success: true,
            newsItems: newsCount,
            digests: digestCount,
            queue: queueStats,
            latencyMs: Date.now() - start,
            domain: parsedEnv.DOMAIN,
            timestamp: new Date().toISOString(),
          },
          200,
          cors
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonResponse({ success: false, error: msg }, 500, cors);
      }
    }

    return jsonResponse({ error: 'Not found' }, 404, cors);
  },

  async scheduled(event: ScheduledEvent, env: Record<string, unknown>, ctx: ExecutionContext): Promise<void> {
    const parsedEnv = parseEnv(env);
    const log = new WorkerLogger(parsedEnv.LOG_LEVEL);
    const cfg: SupabaseConfig = {
      url: parsedEnv.SUPABASE_URL,
      serviceKey: parsedEnv.SUPABASE_SERVICE_KEY,
    };

    const cron = event.cron;
    log.info('Scheduled event received', { cron, scheduledTime: event.scheduledTime, domain: parsedEnv.DOMAIN });

    // ---- Hourly: RSS ingestion ----
    if (cron === '0 * * * *') {
      try {
        const results = await ingestAllFeeds(cfg);
        const totalInserted = results.reduce((sum, r) => sum + r.inserted, 0);
        const errors = results.flatMap((r) => r.errors);

        log.info('Scheduled RSS ingestion completed', {
          totalInserted,
          sources: results.length,
          errors: errors.length,
        });

        await notifySlack(
          parsedEnv.SLACK_WEBHOOK,
          `📰 RSS Ingestion Complete — ${totalInserted} new articles from ${results.length} sources. (${parsedEnv.DOMAIN})`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error('Scheduled RSS ingestion failed', { error: msg });
        await notifySlack(parsedEnv.SLACK_WEBHOOK, `⚠️ RSS Ingestion Failed: ${msg} (${parsedEnv.DOMAIN})`);
      }
      return;
    }

    // ---- Daily 07:00 UTC: Digest generation ----
    if (cron === '0 7 * * *') {
      try {
        // Optional: use Durable Object to prevent duplicate runs in multi-region deployments
        // For simplicity, we rely on cron singleton behavior; Durable Object available if needed.
        const result = await generateDailyDigests(cfg, { lookbackHours: 24 });
        log.info('Scheduled digest generation completed', {
          digests: result.digestsCreated,
          jobs: result.jobsEnqueued,
        });

        await notifySlack(
          parsedEnv.SLACK_WEBHOOK,
          `📋 Daily Digests Generated — ${result.digestsCreated} digests, ${result.jobsEnqueued} delivery jobs enqueued. (${parsedEnv.DOMAIN})`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error('Scheduled digest generation failed', { error: msg });
        await notifySlack(parsedEnv.SLACK_WEBHOOK, `⚠️ Digest Generation Failed: ${msg} (${parsedEnv.DOMAIN})`);
      }
      return;
    }

    log.warn('Unhandled cron pattern', { cron });
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchCount(cfg: SupabaseConfig, table: string): Promise<number> {
  const url = `${cfg.url}/rest/v1/${table}?select=id`;
  const res = await fetch(url, {
    headers: {
      'apikey': cfg.serviceKey,
      'Authorization': `Bearer ${cfg.serviceKey}`,
      'Prefer': 'count=exact',
      'Range': '0-0',
    },
  });
  const countHeader = res.headers.get('content-range');
  if (countHeader) {
    const match = countHeader.match(/\/(\d+)$/);
    return match ? parseInt(match[1], 10) : 0;
  }
  return 0;
}

async function fetchQueueStats(cfg: SupabaseConfig): Promise<Record<string, number>> {
  const states = ['pending', 'active', 'completed', 'failed'];
  const stats: Record<string, number> = {};

  await Promise.all(
    states.map(async (state) => {
      const url = `${cfg.url}/rest/v1/job_queue?state=eq.${state}&select=id`;
      const res = await fetch(url, {
        headers: {
          'apikey': cfg.serviceKey,
          'Authorization': `Bearer ${cfg.serviceKey}`,
          'Prefer': 'count=exact',
          'Range': '0-0',
        },
      });
      const countHeader = res.headers.get('content-range');
      if (countHeader) {
        const match = countHeader.match(/\/(\d+)$/);
        stats[state] = match ? parseInt(match[1], 10) : 0;
      } else {
        stats[state] = 0;
      }
    })
  );

  return stats;
}
