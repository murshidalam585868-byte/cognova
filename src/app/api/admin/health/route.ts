/**
 * src/app/api/admin/health/route.ts
 * Admin System Health API
 *
 * GET  /api/admin/health      → List health snapshots
 * POST /api/admin/health      → Record a new health snapshot
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin/auth';
import { createClient } from '@supabase/supabase-js';
import { loadConfig } from '@/lib/config';
import { logger } from '@/lib/logger';
import type { SystemHealthSnapshot } from '@/types';

function getAdminClient() {
  const config = loadConfig();
  return createClient(config.supabaseUrl!, config.supabaseServiceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const HealthQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(24),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const admin = await requireAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const query = HealthQuerySchema.parse({
      limit: searchParams.get('limit') ?? '24',
    });

    const sb = getAdminClient();
    const { data, error } = await sb
      .from('system_health_snapshots')
      .select('*')
      .order('recorded_at', { ascending: false })
      .limit(query.limit);

    if (error) {
      logger.error('Admin API: failed to list health snapshots', { error: error.message });
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const snapshots: SystemHealthSnapshot[] = (data || []).map((row: Record<string, unknown>) => ({
      id: String(row.id),
      cpuPercent: row.cpu_percent ? Number(row.cpu_percent) : undefined,
      memoryPercent: row.memory_percent ? Number(row.memory_percent) : undefined,
      diskPercent: row.disk_percent ? Number(row.disk_percent) : undefined,
      activeConnections: row.active_connections ? Number(row.active_connections) : undefined,
      queueDepth: row.queue_depth ? Number(row.queue_depth) : undefined,
      apiLatencyMs: row.api_latency_ms ? Number(row.api_latency_ms) : undefined,
      errorRate5m: row.error_rate_5m ? Number(row.error_rate_5m) : undefined,
      openAlerts: row.open_alerts ? Number(row.open_alerts) : undefined,
      status: String(row.status) as SystemHealthSnapshot['status'],
      details: (row.details as Record<string, unknown>) ?? {},
      recordedAt: String(row.recorded_at),
    }));

    return NextResponse.json({ success: true, data: snapshots });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Admin API GET /health error', { error: message });
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

const RecordHealthBodySchema = z.object({
  status: z.enum(['healthy', 'degraded', 'critical']),
  details: z.record(z.unknown()).default({}),
  cpuPercent: z.number().optional(),
  memoryPercent: z.number().optional(),
  diskPercent: z.number().optional(),
  activeConnections: z.number().int().optional(),
  queueDepth: z.number().int().optional(),
  apiLatencyMs: z.number().optional(),
  errorRate5m: z.number().optional(),
  openAlerts: z.number().int().optional(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const admin = await requireAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = RecordHealthBodySchema.parse(body);

    const sb = getAdminClient();
    const { data, error } = await sb
      .from('system_health_snapshots')
      .insert({
        status: parsed.status,
        details: parsed.details,
        cpu_percent: parsed.cpuPercent,
        memory_percent: parsed.memoryPercent,
        disk_percent: parsed.diskPercent,
        active_connections: parsed.activeConnections,
        queue_depth: parsed.queueDepth,
        api_latency_ms: parsed.apiLatencyMs,
        error_rate_5m: parsed.errorRate5m,
        open_alerts: parsed.openAlerts,
      })
      .select('id')
      .single();

    if (error || !data) {
      logger.error('Admin API: failed to record health snapshot', { error: error?.message });
      return NextResponse.json({ success: false, error: error?.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: { id: String(data.id) } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Admin API POST /health error', { error: message });
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
