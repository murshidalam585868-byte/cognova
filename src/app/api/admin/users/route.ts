/**
 * src/app/api/admin/users/route.ts
 * Admin User Management API
 *
 * GET  /api/admin/users     → List users (paginated, searchable)
 * POST /api/admin/users     → Update user role
 * DELETE /api/admin/users   → Delete a user
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, requireSuperAdmin, writeAuditLog } from '@/lib/admin/auth';
import { createClient } from '@supabase/supabase-js';
import { loadConfig } from '@/lib/config';
import { logger } from '@/lib/logger';
import type { UserRole, AdminUser } from '@/types';

function getAdminClient() {
  const config = loadConfig();
  return createClient(config.supabaseUrl!, config.supabaseServiceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const ListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  role: z.enum(['user', 'admin', 'superadmin']).optional(),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const admin = await requireAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const query = ListQuerySchema.parse({
      page: searchParams.get('page') ?? '1',
      perPage: searchParams.get('perPage') ?? '20',
      search: searchParams.get('search') ?? undefined,
      role: (searchParams.get('role') as UserRole) ?? undefined,
    });

    const sb = getAdminClient();
    let dbQuery = sb.from('user_profiles').select('*, user_roles(roles(name))', { count: 'exact' });

    if (query.search) {
      dbQuery = dbQuery.or(`email.ilike.%${query.search}%,name.ilike.%${query.search}%`);
    }

    const { data, error, count } = await dbQuery
      .order('created_at', { ascending: false })
      .range((query.page - 1) * query.perPage, query.page * query.perPage - 1);

    if (error) {
      logger.error('Admin API: failed to list users', { error: error.message });
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
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

    if (query.role) {
      const filtered = users.filter((u) => u.role === query.role);
      return NextResponse.json({
        success: true,
        data: filtered,
        meta: { total: filtered.length, page: query.page, perPage: query.perPage },
      });
    }

    return NextResponse.json({
      success: true,
      data: users,
      meta: { total: count ?? 0, page: query.page, perPage: query.perPage },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Admin API GET /users error', { error: message });
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

const UpdateRoleBodySchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['user', 'admin', 'superadmin']),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const superadmin = await requireSuperAdmin();
    if (!superadmin) {
      return NextResponse.json({ success: false, error: 'Forbidden: superadmin required' }, { status: 403 });
    }

    const body = await request.json();
    const { userId, role } = UpdateRoleBodySchema.parse(body);

    const sb = getAdminClient();
    const { data: roleRow, error: roleError } = await sb
      .from('roles')
      .select('id')
      .eq('name', role)
      .single();

    if (roleError || !roleRow) {
      return NextResponse.json({ success: false, error: 'Role not found' }, { status: 400 });
    }

    const { error } = await sb.from('user_roles').upsert({
      user_id: userId,
      role_id: (roleRow as Record<string, unknown>).id as string,
      assigned_by: superadmin.id,
      assigned_at: new Date().toISOString(),
    });

    if (error) {
      logger.error('Admin API: failed to update role', { error: error.message, userId });
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    await writeAuditLog({
      actorId: superadmin.id,
      action: 'user.role.update',
      resourceType: 'user',
      resourceId: userId,
      result: 'success',
      payload: { newRole: role },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Admin API POST /users error', { error: message });
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

const DeleteBodySchema = z.object({
  userId: z.string().uuid(),
});

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    const superadmin = await requireSuperAdmin();
    if (!superadmin) {
      return NextResponse.json({ success: false, error: 'Forbidden: superadmin required' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const { userId } = DeleteBodySchema.parse(body);

    const sb = getAdminClient();
    const { error } = await sb.auth.admin.deleteUser(userId);

    if (error) {
      logger.error('Admin API: failed to delete user', { error: error.message, userId });
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    await writeAuditLog({
      actorId: superadmin.id,
      action: 'user.delete',
      resourceType: 'user',
      resourceId: userId,
      result: 'success',
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Admin API DELETE /users error', { error: message });
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
