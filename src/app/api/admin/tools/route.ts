/**
 * src/app/api/admin/tools/route.ts
 * Admin Tool Configuration API
 *
 * GET  /api/admin/tools → List all tool admin configs
 * POST /api/admin/tools → Update a tool config
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, userHasPermission, writeAuditLog } from '@/lib/admin/auth';
import { createClient } from '@supabase/supabase-js';
import { loadConfig } from '@/lib/config';
import { logger } from '@/lib/logger';
import type { ToolAdminConfig } from '@/types';

function getAdminClient() {
  const config = loadConfig();
  return createClient(config.supabaseUrl!, config.supabaseServiceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const admin = await requireAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const sb = getAdminClient();
    const { data, error } = await sb
      .from('tool_admin_configs')
      .select('*')
      .order('tool_name', { ascending: true });

    if (error) {
      logger.error('Admin API: failed to list tool configs', { error: error.message });
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const configs: ToolAdminConfig[] = (data || []).map((row: Record<string, unknown>) => ({
      id: String(row.id),
      toolName: String(row.tool_name),
      isEnabled: Boolean(row.is_enabled),
      rateLimitPerMinute: Number(row.rate_limit_per_minute),
      globalTimeoutMs: Number(row.global_timeout_ms),
      config: (row.config as Record<string, unknown>) ?? {},
      updatedBy: row.updated_by ? String(row.updated_by) : undefined,
      updatedAt: String(row.updated_at),
    }));

    return NextResponse.json({ success: true, data: configs });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Admin API GET /tools error', { error: message });
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

const UpdateToolBodySchema = z.object({
  toolName: z.string().min(1),
  isEnabled: z.boolean(),
  rateLimitPerMinute: z.number().int().min(1).max(10000),
  globalTimeoutMs: z.number().int().min(1000).max(300000),
  config: z.record(z.unknown()).default({}),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const admin = await requireAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const hasPermission = await userHasPermission(admin.id, 'tools:write');
    if (!hasPermission) {
      return NextResponse.json({ success: false, error: 'Forbidden: tools:write required' }, { status: 403 });
    }

    const body = await request.json();
    const { toolName, isEnabled, rateLimitPerMinute, globalTimeoutMs, config } =
      UpdateToolBodySchema.parse(body);

    const sb = getAdminClient();
    const { error } = await sb
      .from('tool_admin_configs')
      .update({
        is_enabled: isEnabled,
        rate_limit_per_minute: rateLimitPerMinute,
        global_timeout_ms: globalTimeoutMs,
        config,
        updated_by: admin.id,
      })
      .eq('tool_name', toolName);

    if (error) {
      logger.error('Admin API: failed to update tool config', { error: error.message, toolName });
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    await writeAuditLog({
      actorId: admin.id,
      action: 'tool.config.update',
      resourceType: 'tool',
      resourceId: toolName,
      result: 'success',
      payload: { isEnabled, rateLimitPerMinute, globalTimeoutMs, config },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Admin API POST /tools error', { error: message });
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
