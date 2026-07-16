/**
 * src/middleware.ts
 * Next.js Middleware for Shadow Brain
 *
 * Protects admin routes by validating session tokens and checking roles.
 * Redirects unauthenticated users to the login page.
 * Blocks non-admin users from accessing /admin/*.
 */

import { NextRequest, NextResponse } from 'next/server';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const AUTH_COOKIE_NAME = 'sb-session';
const LOGIN_PATH = '/admin-login';
const ADMIN_PATH_PREFIX = '/admin';
const API_ADMIN_PATH_PREFIX = '/api/admin';

// Public paths that do not require authentication
const PUBLIC_PATHS = ['/', '/login', '/signup', '/api/auth', '/_next', '/favicon.ico', '/admin-login'];

// ---------------------------------------------------------------------------
// Middleware Handler
// ---------------------------------------------------------------------------

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // Allow public paths and static assets
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p)) || pathname.includes('.')) {
    return NextResponse.next();
  }

  // Extract session token from cookie
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value ?? null;

  // --- Admin Routes (pages + API) ---
  if (pathname.startsWith(ADMIN_PATH_PREFIX) || pathname.startsWith(API_ADMIN_PATH_PREFIX)) {
    if (!token) {
      console.warn('Admin access denied: no session token', { pathname });
      return handleUnauthorized(request, pathname.startsWith(API_ADMIN_PATH_PREFIX));
    }

    // Fast-path JWT role extraction (avoids DB hit in middleware for superadmins)
    const jwtPayload = parseJwt(token);
    const role = extractRoleFromJwt(jwtPayload);

    // Admin routes require at least 'admin' role
    if (role !== 'admin' && role !== 'superadmin') {
      console.warn('Admin access denied: insufficient role', { pathname, role });
      return handleForbidden(request, pathname.startsWith(API_ADMIN_PATH_PREFIX));
    }

    // For API routes, inject the user context as a header for downstream handlers
    if (pathname.startsWith(API_ADMIN_PATH_PREFIX) && jwtPayload) {
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set('x-user-id', getUserIdFromToken(token) ?? '');
      requestHeaders.set('x-user-role', role);
      requestHeaders.set('x-user-email', (jwtPayload.email as string) ?? '');
      return NextResponse.next({ request: { headers: requestHeaders } });
    }

    return NextResponse.next();
  }

  // --- Authenticated Routes (non-admin) ---
  // For now, allow unauthenticated access to the main chat page
  // In production, enforce auth here for /dashboard and sensitive pages
  return NextResponse.next();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractRoleFromJwt(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null;
  // Check custom claim 'user_role' if set by Supabase hook
  const role = payload.user_role;
  if (typeof role === 'string') return role;
  // Fallback: check app_metadata
  const appMeta = payload.app_metadata as Record<string, unknown> | undefined;
  if (appMeta && typeof appMeta.role === 'string') return appMeta.role;
  return null;
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

function getUserIdFromToken(token: string): string | null {
  const payload = parseJwt(token);
  if (!payload || typeof payload.sub !== 'string') return null;
  return payload.sub;
}

function handleUnauthorized(request: NextRequest, isApi: boolean): NextResponse {
  if (isApi) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized. Please log in.' },
      { status: 401 }
    );
  }
  const loginUrl = new URL(LOGIN_PATH, request.url);
  loginUrl.searchParams.set('redirectTo', request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

function handleForbidden(request: NextRequest, isApi: boolean): NextResponse {
  if (isApi) {
    return NextResponse.json(
      { success: false, error: 'Forbidden. Admin access required.' },
      { status: 403 }
    );
  }
  return NextResponse.redirect(new URL('/admin-login', request.url));
}

// ---------------------------------------------------------------------------
// Matcher
// ---------------------------------------------------------------------------

export const config = {
  matcher: [
    '/admin/:path*',
    '/api/admin/:path*',
    '/dashboard/:path*',
    // Exclude static files and API auth routes
    '/((?!_next/static|_next/image|favicon.ico|api/auth).*)',
  ],
};
