/**
 * src/lib/admin/actions.ts
 * Server Actions for the Admin Panel
 *
 * Provides typed, Zod-validated server actions for:
 *   - User management (CRUD, role assignment)
 *   - Audit log queries
 *   - Memory browsing and deletion
 *   - System health metrics
 *   - Tool configuration updates
 */

'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { loadConfig } from '@/lib/config';
import { logger } from '@/lib/logger';
import {
  getCurrentUser,
  requireAdmin,
  requireSuperAdmin,
  writeAuditLog,
  assignUserRole,
  userHasPermission,
} from '@/lib/admin/auth';
import type {
  AdminUser,
  AuditLog,
  SystemHealthSnapshot,
  ToolAdminConfig,
  MemoryEntry,
  Conversation,
  UserRole,
} from '@/types';

// ---------------------------------------------------------------------------
// Supabase Admin Client
// ---------------------------------------------------------------------------

function getAdminClient() {
  const config = loadConfig();
  if (!config.supabaseUrl || !config.supabaseServiceKey) {
    throw new Error('Supabase not configured');
  }
  return createClient(config.supabaseUrl, config.supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ---------------------------------------------------------------------------
// User Management Actions
// ---------------------------------------------------------------------------

const UserListSchema = z.object({
  page: z.number().int().min(1).default(1),
  perPage: z.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  role: z.enum(['user', 'admin', 'superadmin']).optional(),
});

export type UserListInput = z.infer<typeof UserListSchema>;

export async function listUsers(input: UserListInput): Promise<{
  users: AdminUser[];
  total: number;
}> {
  const admin = await requireAdmin();
  if (!admin) throw new Error('Unauthorized');

  const sb = getAdminClient();
  const { page, perPage, search, role } = UserListSchema.parse(input);

  let query = sb
    .from('user_profiles')
    .select('*, user_roles(roles(name))', { count: 'exact' });

  if (search) {
    query = query.or(`email.ilike.%${search}%,name.ilike.%${search}%`);
  }

  if (role) {
    query = query.eq('user_roles.roles.name', role);
  }

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range((page - 1) * perPage, page * perPage - 1);

  if (error) {
    logger.error('Failed to list users', { error: error.message });
    throw new Error(`DB error: ${error.message}`);
  }

  const users: AdminUser[] = (data || []).map((row: Record<string, unknown>) => {
    const roleData = (row.user_roles as Array<Record<string, unknown>>)?.[0];
    const roleName = (roleData?.roles as Record<string, unknown>)?.name as UserRole;

    return {
      id: String(row.id),
      email: String(row.email),
      name: String(row.name),
      role: (roleName ?? 'user') as UserRole,
      preferences: (row.preferences as AdminUser['preferences']) ?? {},
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      isActive: true,
    };
  });

  await writeAuditLog({
    actorId: admin.id,
    action: 'users.list',
    resourceType: 'user',
    result: 'success',
    payload: { page, perPage, search, role },
  });

  return { users, total: count ?? 0 };
}

const UpdateUserRoleSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['user', 'admin', 'superadmin']),
});

export type UpdateUserRoleInput = z.infer<typeof UpdateUserRoleSchema>;

export async function updateUserRole(input: UpdateUserRoleInput): Promise<void> {
  const superadmin = await requireSuperAdmin();
  if (!superadmin) throw new Error('Forbidden: superadmin required');

  const { userId, role } = UpdateUserRoleSchema.parse(input);

  const success = await assignUserRole(userId, role, superadmin.id);
  if (!success) throw new Error('Failed to update user role');

  await writeAuditLog({
    actorId: superadmin.id,
    action: 'user.role.update',
    resourceType: 'user',
    resourceId: userId,
    result: 'success',
    payload: { newRole: role },
  });

  revalidatePath('/admin/users');
}

const DeleteUserSchema = z.object({
  userId: z.string().uuid(),
});

export type DeleteUserInput = z.infer<typeof DeleteUserSchema>;

export async function deleteUser(input: DeleteUserInput): Promise<void> {
  const superadmin = await requireSuperAdmin();
  if (!superadmin) throw new Error('Forbidden: superadmin required');

  const { userId } = DeleteUserSchema.parse(input);
  const sb = getAdminClient();

  // Cascade delete is handled by DB constraints, but we delete auth user explicitly
  const { error } = await sb.auth.admin.deleteUser(userId);
  if (error) {
    logger.error('Failed to delete user', { error: error.message, userId });
    throw new Error(`Auth error: ${error.message}`);
  }

  await writeAuditLog({
    actorId: superadmin.id,
    action: 'user.delete',
    resourceType: 'user',
    resourceId: userId,
    result: 'success',
  });

  revalidatePath('/admin/users');
}

// ---------------------------------------------------------------------------
// Audit Log Actions
// ---------------------------------------------------------------------------

const AuditLogListSchema = z.object({
  page: z.number().int().min(1).default(1),
  perPage: z.number().int().min(1).max(100).default(50),
  action: z.string().optional(),
  resourceType: z.string().optional(),
  result: z.enum(['success', 'failure', 'blocked']).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

export type AuditLogListInput = z.infer<typeof AuditLogListSchema>;

export async function listAuditLogs(input: AuditLogListInput): Promise<{
  logs: AuditLog[];
  total: number;
}> {
  const admin = await requireAdmin();
  if (!admin) throw new Error('Unauthorized');

  const sb = getAdminClient();
  const { page, perPage, action, resourceType, result, startDate, endDate } =
    AuditLogListSchema.parse(input);

  let query = sb.from('audit_logs').select('*', { count: 'exact' });

  if (action) query = query.eq('action', action);
  if (resourceType) query = query.eq('resource_type', resourceType);
  if (result) query = query.eq('result', result);
  if (startDate) query = query.gte('created_at', startDate);
  if (endDate) query = query.lte('created_at', endDate);

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range((page - 1) * perPage, page * perPage - 1);

  if (error) {
    logger.error('Failed to list audit logs', { error: error.message });
    throw new Error(`DB error: ${error.message}`);
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

  return { logs, total: count ?? 0 };
}

// ---------------------------------------------------------------------------
// Memory Browser Actions
// ---------------------------------------------------------------------------

const MemoryListSchema = z.object({
  page: z.number().int().min(1).default(1),
  perPage: z.number().int().min(1).max(100).default(50),
  userId: z.string().uuid().optional(),
  namespace: z.string().optional(),
  search: z.string().optional(),
});

export type MemoryListInput = z.infer<typeof MemoryListSchema>;

export async function listMemories(input: MemoryListInput): Promise<{
  memories: MemoryEntry[];
  total: number;
}> {
  const admin = await requireAdmin();
  if (!admin) throw new Error('Unauthorized');

  const sb = getAdminClient();
  const { page, perPage, userId, namespace, search } = MemoryListSchema.parse(input);

  let query = sb.from('memories').select('*', { count: 'exact' });

  if (userId) query = query.eq('user_id', userId);
  if (namespace) query = query.eq('namespace', namespace);
  if (search) query = query.ilike('content', `%${search}%`);

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range((page - 1) * perPage, page * perPage - 1);

  if (error) {
    logger.error('Failed to list memories', { error: error.message });
    throw new Error(`DB error: ${error.message}`);
  }

  const memories: MemoryEntry[] = (data || []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    userId: String(row.user_id),
    namespace: String(row.namespace),
    content: String(row.content),
    embedding: (row.embedding as number[]) ?? [],
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: String(row.created_at),
  }));

  return { memories, total: count ?? 0 };
}

const DeleteMemorySchema = z.object({
  memoryId: z.string().uuid(),
});

export type DeleteMemoryInput = z.infer<typeof DeleteMemorySchema>;

export async function deleteMemory(input: DeleteMemoryInput): Promise<void> {
  const admin = await requireAdmin();
  if (!admin) throw new Error('Unauthorized');

  const hasPermission = await userHasPermission(admin.id, 'memory:delete');
  if (!hasPermission) throw new Error('Forbidden: missing memory:delete permission');

  const { memoryId } = DeleteMemorySchema.parse(input);
  const sb = getAdminClient();

  const { error } = await sb.from('memories').delete().eq('id', memoryId);
  if (error) {
    logger.error('Failed to delete memory', { error: error.message, memoryId });
    throw new Error(`DB error: ${error.message}`);
  }

  await writeAuditLog({
    actorId: admin.id,
    action: 'memory.delete',
    resourceType: 'memory',
    resourceId: memoryId,
    result: 'success',
  });

  revalidatePath('/admin/memory');
}

// ---------------------------------------------------------------------------
// Conversation Audit Actions
// ---------------------------------------------------------------------------

const ConversationListSchema = z.object({
  page: z.number().int().min(1).default(1),
  perPage: z.number().int().min(1).max(100).default(50),
  userId: z.string().uuid().optional(),
  search: z.string().optional(),
});

export type ConversationListInput = z.infer<typeof ConversationListSchema>;

export async function listConversations(input: ConversationListInput): Promise<{
  conversations: Conversation[];
  total: number;
}> {
  const admin = await requireAdmin();
  if (!admin) throw new Error('Unauthorized');

  const sb = getAdminClient();
  const { page, perPage, userId, search } = ConversationListSchema.parse(input);

  let query = sb.from('conversations').select('*', { count: 'exact' });

  if (userId) query = query.eq('user_id', userId);
  if (search) query = query.ilike('title', `%${search}%`);

  const { data, error, count } = await query
    .order('updated_at', { ascending: false })
    .range((page - 1) * perPage, page * perPage - 1);

  if (error) {
    logger.error('Failed to list conversations', { error: error.message });
    throw new Error(`DB error: ${error.message}`);
  }

  const conversations: Conversation[] = (data || []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    userId: String(row.user_id),
    title: String(row.title),
    messages: [],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }));

  return { conversations, total: count ?? 0 };
}

// ---------------------------------------------------------------------------
// System Health Actions
// ---------------------------------------------------------------------------

export async function getSystemHealth(): Promise<{
  snapshots: SystemHealthSnapshot[];
  latest: SystemHealthSnapshot | null;
}> {
  const admin = await requireAdmin();
  if (!admin) throw new Error('Unauthorized');

  const sb = getAdminClient();

  const [{ data: snapshots, error: snapError }, { data: latest, error: latestError }] =
    await Promise.all([
      sb
        .from('system_health_snapshots')
        .select('*')
        .order('recorded_at', { ascending: false })
        .limit(24),
      sb
        .from('system_health_snapshots')
        .select('*')
        .order('recorded_at', { ascending: false })
        .limit(1)
        .single(),
    ]);

  if (snapError || latestError) {
    logger.error('Failed to fetch system health', {
      snapError: snapError?.message,
      latestError: latestError?.message,
    });
    throw new Error('DB error');
  }

  const mapSnapshot = (row: Record<string, unknown>): SystemHealthSnapshot => ({
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
  });

  return {
    snapshots: (snapshots || []).map(mapSnapshot),
    latest: latest ? mapSnapshot(latest) : null,
  };
}

const RecordHealthSnapshotSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'critical']),
  details: z.record(z.unknown()).default({}),
});

export type RecordHealthSnapshotInput = z.infer<typeof RecordHealthSnapshotSchema>;

export async function recordHealthSnapshot(input: RecordHealthSnapshotInput): Promise<string> {
  const admin = await requireAdmin();
  if (!admin) throw new Error('Unauthorized');

  const { status, details } = RecordHealthSnapshotSchema.parse(input);
  const sb = getAdminClient();

  const { data, error } = await sb
    .from('system_health_snapshots')
    .insert({ status, details })
    .select('id')
    .single();

  if (error || !data) {
    logger.error('Failed to record health snapshot', { error: error?.message });
    throw new Error(`DB error: ${error?.message}`);
  }

  await writeAuditLog({
    actorId: admin.id,
    action: 'system.health.record',
    resourceType: 'system',
    result: 'success',
    payload: { status, details },
  });

  revalidatePath('/admin/health');
  return String(data.id);
}

// ---------------------------------------------------------------------------
// Tool Configuration Actions
// ---------------------------------------------------------------------------

export async function listToolConfigs(): Promise<ToolAdminConfig[]> {
  const admin = await requireAdmin();
  if (!admin) throw new Error('Unauthorized');

  const sb = getAdminClient();
  const { data, error } = await sb
    .from('tool_admin_configs')
    .select('*')
    .order('tool_name', { ascending: true });

  if (error) {
    logger.error('Failed to list tool configs', { error: error.message });
    throw new Error(`DB error: ${error.message}`);
  }

  return (data || []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    toolName: String(row.tool_name),
    isEnabled: Boolean(row.is_enabled),
    rateLimitPerMinute: Number(row.rate_limit_per_minute),
    globalTimeoutMs: Number(row.global_timeout_ms),
    config: (row.config as Record<string, unknown>) ?? {},
    updatedBy: row.updated_by ? String(row.updated_by) : undefined,
    updatedAt: String(row.updated_at),
  }));
}

const UpdateToolConfigSchema = z.object({
  toolName: z.string().min(1),
  isEnabled: z.boolean(),
  rateLimitPerMinute: z.number().int().min(1).max(10000),
  globalTimeoutMs: z.number().int().min(1000).max(300000),
  config: z.record(z.unknown()).default({}),
});

export type UpdateToolConfigInput = z.infer<typeof UpdateToolConfigSchema>;

export async function updateToolConfig(input: UpdateToolConfigInput): Promise<void> {
  const admin = await requireAdmin();
  if (!admin) throw new Error('Unauthorized');

  const hasPermission = await userHasPermission(admin.id, 'tools:write');
  if (!hasPermission) throw new Error('Forbidden: missing tools:write permission');

  const { toolName, isEnabled, rateLimitPerMinute, globalTimeoutMs, config } =
    UpdateToolConfigSchema.parse(input);
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
    logger.error('Failed to update tool config', { error: error.message, toolName });
    throw new Error(`DB error: ${error.message}`);
  }

  await writeAuditLog({
    actorId: admin.id,
    action: 'tool.config.update',
    resourceType: 'tool',
    resourceId: toolName,
    result: 'success',
    payload: { isEnabled, rateLimitPerMinute, globalTimeoutMs, config },
  });

  revalidatePath('/admin/tools');
}

// ---------------------------------------------------------------------------
// Dashboard Stats
// ---------------------------------------------------------------------------

export async function getDashboardStats(): Promise<{
  totalUsers: number;
  totalConversations: number;
  totalMessages: number;
  totalMemories: number;
  activeUsers24h: number;
  failedJobs: number;
  openAlerts: number;
  systemStatus: 'healthy' | 'degraded' | 'critical';
}> {
  const admin = await requireAdmin();
  if (!admin) throw new Error('Unauthorized');

  const sb = getAdminClient();
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [
    { count: totalUsers },
    { count: totalConversations },
    { count: totalMessages },
    { count: totalMemories },
    { count: activeUsers24h },
    { count: failedJobs },
    { count: openAlerts },
    { data: latestHealth },
  ] = await Promise.all([
    sb.from('user_profiles').select('*', { count: 'exact', head: true }),
    sb.from('conversations').select('*', { count: 'exact', head: true }),
    sb.from('messages').select('*', { count: 'exact', head: true }),
    sb.from('memories').select('*', { count: 'exact', head: true }),
    sb.from('user_profiles').select('*', { count: 'exact', head: true }).gte('updated_at', oneDayAgo),
    sb.from('job_queue').select('*', { count: 'exact', head: true }).eq('state', 'failed'),
    sb.from('siem_alerts').select('*', { count: 'exact', head: true }).is('acknowledged_at', null),
    sb.from('system_health_snapshots').select('status').order('recorded_at', { ascending: false }).limit(1).single(),
  ]);

  return {
    totalUsers: totalUsers ?? 0,
    totalConversations: totalConversations ?? 0,
    totalMessages: totalMessages ?? 0,
    totalMemories: totalMemories ?? 0,
    activeUsers24h: activeUsers24h ?? 0,
    failedJobs: failedJobs ?? 0,
    openAlerts: openAlerts ?? 0,
    systemStatus: (latestHealth?.status as 'healthy' | 'degraded' | 'critical') ?? 'healthy',
  };
}
