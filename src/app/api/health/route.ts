/**
 * src/app/api/health/route.ts
 * Production health check endpoint for Shadow Brain.
 * Returns service status, version, and dependency connectivity.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseClient } from '@/lib/db/supabase';
import { getRedisConnection } from '@/lib/queue/redis';
import { logger } from '@/lib/logger';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const HealthStatusSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'unhealthy']),
  version: z.string(),
  timestamp: z.string().datetime(),
  uptime: z.number(),
  environment: z.string(),
  services: z.object({
    app: z.enum(['up', 'down']),
    database: z.enum(['up', 'down']),
    redis: z.enum(['up', 'down']),
  }),
  checks: z.object({
    database: z.object({
      status: z.enum(['up', 'down']),
      responseTimeMs: z.number(),
      message: z.string().optional(),
    }),
    redis: z.object({
      status: z.enum(['up', 'down']),
      responseTimeMs: z.number(),
      message: z.string().optional(),
    }),
  }),
});

export type HealthStatus = z.infer<typeof HealthStatusSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function checkDatabase(): Promise<{ status: 'up' | 'down'; responseTimeMs: number; message?: string }> {
  const start = performance.now();
  try {
    const sb = getSupabaseClient();
    const { error } = await sb.from('conversations').select('id', { count: 'exact', head: true });
    const responseTimeMs = Math.round(performance.now() - start);
    if (error) {
      return { status: 'down', responseTimeMs, message: error.message };
    }
    return { status: 'up', responseTimeMs };
  } catch (err) {
    const responseTimeMs = Math.round(performance.now() - start);
    return { status: 'down', responseTimeMs, message: (err as Error).message };
  }
}

async function checkRedis(): Promise<{ status: 'up' | 'down'; responseTimeMs: number; message?: string }> {
  const start = performance.now();
  try {
    const redis = getRedisConnection();
    await redis.ping();
    const responseTimeMs = Math.round(performance.now() - start);
    return { status: 'up', responseTimeMs };
  } catch (err) {
    const responseTimeMs = Math.round(performance.now() - start);
    return { status: 'down', responseTimeMs, message: (err as Error).message };
  }
}

// ---------------------------------------------------------------------------
// GET Handler
// ---------------------------------------------------------------------------

export async function GET(): Promise<Response> {
  const [dbCheck, redisCheck] = await Promise.all([checkDatabase(), checkRedis()]);

  const allUp = dbCheck.status === 'up' && redisCheck.status === 'up';
  const anyDown = dbCheck.status === 'down' || redisCheck.status === 'down';

  const status: HealthStatus['status'] = allUp ? 'healthy' : anyDown ? 'unhealthy' : 'degraded';

  const health: HealthStatus = {
    status,
    version: process.env.npm_package_version || '0.1.0',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    environment: process.env.NODE_ENV || 'development',
    services: {
      app: 'up',
      database: dbCheck.status,
      redis: redisCheck.status,
    },
    checks: {
      database: dbCheck,
      redis: redisCheck,
    },
  };

  const httpStatus = status === 'healthy' ? 200 : status === 'degraded' ? 503 : 503;

  if (status !== 'healthy') {
    logger.warn('Health check degraded', {
      status,
      database: dbCheck.status,
      redis: redisCheck.status,
    });
  }

  return NextResponse.json(health, {
    status: httpStatus,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      'Content-Type': 'application/json',
    },
  });
}
