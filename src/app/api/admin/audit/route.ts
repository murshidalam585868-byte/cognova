/**
 * src/app/api/admin/audit/route.ts
 * Admin Audit Log API
 *
 * GET /api/admin/audit — List audit logs with filters
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin/auth';
import { createClient } from '@supabase/supabase-js';
import { loadConfig } from '@/lib/config';
import { logger } from '@/lib/logger';
import type { AuditLog } from '@/types';

function getAdminClient() {
  const config = loadConfig();
  return createClient(config.supabaseUrl!, config.supabaseServiceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const AuditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(50),
  action: z.string().optional(),
  resourceType: z.string().optional(),
  result: z.enum(['success', 'failure', 'blocked']).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const admin = await requireAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const query = AuditQuerySchema.parse({
      page: searchParams.get('page') ?? '1',
      perPage: searchParams.get('perPage') ?? '50',
      action: searchParams.get('action') ?? undefined,
      resourceType: searchParams.get('resourceType') ?? undefined,
      result: (searchParams.get('result') as 'success' | 'failure' | 'blocked') ?? undefined,
      startDate: searchParams.get('startDate') ?? undefined,
      endDate: searchParams.get('endDate') ?? undefined,
    });

    const sb = getAdminClient();
    let dbQuery = sb.from('audit_logs').select('*', { count: 'exact' });

    if (query.action) dbQuery = dbQuery.eq('action', query.action);
    if (query.resourceType) dbQuery = dbQuery.eq('resource_type', query.resourceType);
    if (query.result) dbQuery = dbQuery.eq('result', query.result);
    if (query.startDate) dbQuery = dbQuery.gte('created_at', query.startDate);
    if (query.endDate) dbQuery = dbQuery.lte('created_at', query.endDate);

    const { data, error, count } = await dbQuery
      .order('created_at', { ascending: false })
      .range((query.page - 1) * query.perPage, query.page * query.perPage - 1);

    if (error) {
      logger.error('Admin API: failed to list audit logs', { error: error.message });
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const logs: AuditLog[] = (data || []).map((row: Record<string, unknown>) => ({
      id: String(row.id),
      actorId: row.actor_id ? String(row.actor_id) : undefined,
      actorEmail: row.actor_email ? String(row.actor_email) : undefined,
      actorRole: row.actor_role ? String(row.actor_role) : undefined,
      action: String(row.action),
      resourceType: String(row.resource_type),
      resourceId: row.resource_id ? String(row.resource_id) : undefined,
      payload: (row.payload as Record<string, unknown>) ?? {},
      result: String(row.result) as AuditLog['result'],
      errorMessage: row.error_message ? String(row.error_message) : undefined,
      ipAddress: row.ip_address ? String(row.ip_address) : undefined,
      userAgent: row.user_agent ? String(row.user_agent) : undefined,
      sessionId: row.session_id ? String(row.session_id) : undefined,
      createdAt: String(row.created_at),
    }));

    return NextResponse.json({
      success: true,
      data: logs,
      meta: { total: count ?? 0, page: query.page, perPage: query.perPage },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Admin API GET /audit error', { error: message });
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
