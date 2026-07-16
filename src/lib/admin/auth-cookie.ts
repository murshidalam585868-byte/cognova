/**
 * src/lib/admin/auth-cookie.ts
 * Temporary cookie-based admin auth for server components.
 * Falls back when Supabase is not yet configured.
 */

import { cookies } from 'next/headers';

export interface CookieAdminUser {
  id: string;
  email: string;
  role: 'admin' | 'superadmin';
}

export async function getAdminFromCookie(): Promise<CookieAdminUser | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('sb-session')?.value ?? null;
    if (!token) return null;

    const payload = parseJwt(token);
    if (!payload) return null;

    const role = payload.user_role as string | undefined;
    if (role !== 'admin' && role !== 'superadmin') return null;

    return {
      id: (payload.sub as string) ?? 'unknown',
      email: (payload.email as string) ?? 'admin@brain.mr-imperfect.online',
      role,
    };
  } catch {
    return null;
  }
}

function parseJwt(token: string): Record<string, unknown> | null {
  try {
    const base64Payload = token.split('.')[1];
    if (!base64Payload) return null;
    const payload = Buffer.from(base64Payload, 'base64').toString('utf-8');
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return null;
  }
}
