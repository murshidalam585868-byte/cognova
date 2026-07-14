/**
 * src/lib/admin/auth.ts
 * Role-based access control (RBAC) utilities for the admin panel.
 *
 * Provides:
 *   - Session validation via Supabase Auth + cookie introspection
 *   - Role fetching and caching
 *   - Permission checking
 *   - Admin-only route guards
 *   - Audit logging helpers
 */

import { cookies } from 'next/headers';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { loadConfig } from '@/lib/config';
import { logger } from '@/lib/logger';
import type { UserRole, Permission, AdminSession } from '@/types';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const AUTH_COOKIE_NAME = 'sb-session';

function getSupabaseAdminClient(): SupabaseClient {
  const config = loadConfig();
  if (!config.supabaseUrl || !config.supabaseServiceKey) {
    throw new Error('Supabase URL and Service Role Key must be configured.');
  }
  return createClient(config.supabaseUrl, config.supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ---------------------------------------------------------------------------
// Session Helpers
// ---------------------------------------------------------------------------

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  sessionToken?: string;
}

/**
 * Extract the Supabase JWT from the request cookies.
 */
export async function getSessionToken(): Promise<string | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(AUTH_COOKIE_NAME)?.value ?? null;
    return token;
  } catch {
    return null;
  }
}

/**
 * Validate the session token with Supabase and return the user.
 * In production, this verifies the JWT signature against Supabase secrets.
 */
export async function validateSession(token: string | null): Promise<AuthenticatedUser | null> {
  if (!token) return null;

  try {
    const sb = getSupabaseAdminClient();
    const { data, error } = await sb.auth.getUser(token);

    if (error || !data.user) {
      logger.warn('Session validation failed', { error: error?.message });
      return null;
    }

    const user = data.user;
    const role = await fetchUserRole(user.id);

    return {
      id: user.id,
      email: user.email ?? '',
      role,
      sessionToken: token,
    };
  } catch (err) {
    logger.error('Unexpected session validation error', { error: (err as Error).message });
    return null;
  }
}

/**
 * Get the currently authenticated user from cookies.
 * Safe to call in Server Components, Server Actions, and Route Handlers.
 */
export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const token = await getSessionToken();
  return validateSession(token);
}

// ---------------------------------------------------------------------------
// Role & Permission Helpers
// ---------------------------------------------------------------------------

/**
 * Fetch the user's primary role from the database.
 */
export async function fetchUserRole(userId: string): Promise<UserRole> {
  try {
    const sb = getSupabaseAdminClient();
    const { data, error } = await sb
      .from('user_roles')
      .select('roles(name)')
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      // Default to 'user' if no role is assigned
      return 'user';
    }

    const roleName = (data as Record<string, unknown>)?.roles;
    if (typeof roleName === 'object' && roleName !== null && 'name' in roleName) {
      return (roleName as { name: string }).name as UserRole;
    }
    return 'user';
  } catch (err) {
    logger.error('Failed to fetch user role', { error: (err as Error).message, userId });
    return 'user';
  }
}

/**
 * Check if a user has a specific permission code.
 */
export async function userHasPermission(userId: string, permissionCode: string): Promise<boolean> {
  try {
    const sb = getSupabaseAdminClient();
    const { data, error } = await sb.rpc('user_has_permission', {
      p_user_id: userId,
      p_permission_code: permissionCode,
    });

    if (error) {
      logger.error('Permission check failed', { error: error.message, userId, permissionCode });
      return false;
    }

    return !!data;
  } catch (err) {
    logger.error('Unexpected permission check error', { error: (err as Error).message, userId, permissionCode });
    return false;
  }
}

/**
 * Check if a user has any of the given permission codes.
 */
export async function userHasAnyPermission(userId: string, permissionCodes: string[]): Promise<boolean> {
  for (const code of permissionCodes) {
    if (await userHasPermission(userId, code)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Role Hierarchy Guards
// ---------------------------------------------------------------------------

const ROLE_RANK: Record<UserRole, number> = {
  user: 0,
  admin: 1,
  superadmin: 2,
};

/**
 * Check if a user's role rank is at least the required rank.
 */
export function hasMinimumRank(userRole: UserRole, requiredRole: UserRole): boolean {
  return ROLE_RANK[userRole] >= ROLE_RANK[requiredRole];
}

/**
 * Require a minimum role. Returns the user if authorized, otherwise null.
 */
export async function requireRole(minRole: UserRole): Promise<AuthenticatedUser | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  if (!hasMinimumRank(user.role, minRole)) return null;
  return user;
}

/**
 * Require admin or superadmin access.
 */
export async function requireAdmin(): Promise<AuthenticatedUser | null> {
  return requireRole('admin');
}

/**
 * Require superadmin access.
 */
export async function requireSuperAdmin(): Promise<AuthenticatedUser | null> {
  return requireRole('superadmin');
}

// ---------------------------------------------------------------------------
// Middleware Helpers (for use in middleware.ts)
// ---------------------------------------------------------------------------

/**
 * Parse a JWT token without verification (for middleware use only).
 * Returns the payload if the token is well-formed.
 */
export function parseJwt(token: string): Record<string, unknown> | null {
  try {
    const base64Payload = token.split('.')[1];
    if (!base64Payload) return null;
    const payload = Buffer.from(base64Payload, 'base64').toString('utf-8');
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Extract user ID from a JWT token without full verification.
 * Used in middleware for fast path checks before hitting the DB.
 */
export function getUserIdFromToken(token: string): string | null {
  const payload = parseJwt(token);
  if (!payload || typeof payload.sub !== 'string') return null;
  return payload.sub;
}

// ---------------------------------------------------------------------------
// Audit Logging
// ---------------------------------------------------------------------------

export interface AuditLogEntry {
  actorId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  payload?: Record<string, unknown>;
  result?: 'success' | 'failure' | 'blocked';
  errorMessage?: string;
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
}

/**
 * Write an audit log entry to the database.
 */
export async function writeAuditLog(entry: AuditLogEntry): Promise<string | null> {
  try {
    const sb = getSupabaseAdminClient();
    const { data, error } = await sb.rpc('log_audit_event', {
      p_actor_id: entry.actorId ?? null,
      p_action: entry.action,
      p_resource_type: entry.resourceType,
      p_resource_id: entry.resourceId ?? null,
      p_payload: entry.payload ?? {},
      p_result: entry.result ?? 'success',
      p_error_message: entry.errorMessage ?? null,
      p_ip_address: entry.ipAddress ?? null,
      p_user_agent: entry.userAgent ?? null,
      p_session_id: entry.sessionId ?? null,
    });

    if (error) {
      logger.error('Failed to write audit log', { error: error.message, entry });
      return null;
    }

    return typeof data === 'string' ? data : null;
  } catch (err) {
    logger.error('Unexpected audit log write error', { error: (err as Error).message, entry });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Admin Session Tracking
// ---------------------------------------------------------------------------

/**
 * Record a new admin session in the database.
 */
export async function createAdminSession(
  userId: string,
  tokenHash: string,
  ipAddress: string | null,
  userAgent: string | null,
  expiresAt: Date
): Promise<string | null> {
  try {
    const sb = getSupabaseAdminClient();
    const { data, error } = await sb
      .from('admin_sessions')
      .insert({
        user_id: userId,
        session_token_hash: tokenHash,
        ip_address: ipAddress,
        user_agent: userAgent,
        expires_at: expiresAt.toISOString(),
      })
      .select('id')
      .single();

    if (error || !data) {
      logger.error('Failed to create admin session', { error: error?.message, userId });
      return null;
    }

    return (data as Record<string, unknown>)?.id as string;
  } catch (err) {
    logger.error('Unexpected admin session creation error', { error: (err as Error).message, userId });
    return null;
  }
}

/**
 * Revoke an admin session.
 */
export async function revokeAdminSession(sessionId: string, reason: string): Promise<boolean> {
  try {
    const sb = getSupabaseAdminClient();
    const { error } = await sb
      .from('admin_sessions')
      .update({ revoked_at: new Date().toISOString(), revoked_reason: reason })
      .eq('id', sessionId);

    if (error) {
      logger.error('Failed to revoke admin session', { error: error.message, sessionId });
      return false;
    }

    return true;
  } catch (err) {
    logger.error('Unexpected session revocation error', { error: (err as Error).message, sessionId });
    return false;
  }
}

// ---------------------------------------------------------------------------
// Role Management (Superadmin only)
// ---------------------------------------------------------------------------

/**
 * Assign a role to a user. Superadmin only.
 */
export async function assignUserRole(
  userId: string,
  roleName: UserRole,
  assignedBy: string
): Promise<boolean> {
  try {
    const sb = getSupabaseAdminClient();

    const { data: roleData, error: roleError } = await sb
      .from('roles')
      .select('id')
      .eq('name', roleName)
      .single();

    if (roleError || !roleData) {
      logger.error('Role not found', { roleName });
      return false;
    }

    const roleId = (roleData as Record<string, unknown>).id as string;

    const { error } = await sb.from('user_roles').upsert({
      user_id: userId,
      role_id: roleId,
      assigned_by: assignedBy,
      assigned_at: new Date().toISOString(),
    });

    if (error) {
      logger.error('Failed to assign role', { error: error.message, userId, roleName });
      return false;
    }

    return true;
  } catch (err) {
    logger.error('Unexpected role assignment error', { error: (err as Error).message, userId, roleName });
    return false;
  }
}

/**
 * Get all permissions for a role.
 */
export async function getRolePermissions(roleName: UserRole): Promise<Permission[]> {
  try {
    const sb = getSupabaseAdminClient();
    const { data, error } = await sb
      .from('role_permissions')
      .select('permissions(*)')
      .eq('roles.name', roleName);

    if (error || !data) {
      logger.error('Failed to fetch role permissions', { error: error?.message, roleName });
      return [];
    }

    return (data as Array<Record<string, unknown>>).map((row) => {
      const perm = row.permissions as Record<string, unknown>;
      return {
        id: String(perm.id),
        code: String(perm.code),
        name: String(perm.name),
        description: String(perm.description ?? ''),
        resource: String(perm.resource),
        action: String(perm.action),
        createdAt: String(perm.created_at),
      };
    });
  } catch (err) {
    logger.error('Unexpected role permissions fetch error', { error: (err as Error).message, roleName });
    return [];
  }
}
