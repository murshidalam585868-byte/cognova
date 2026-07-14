/**
 * src/app/api/admin/route.ts
 * Admin API Router — Dispatches requests to sub-handlers.
 *
 * All admin API routes are protected by middleware (src/middleware.ts).
 * This route acts as a health check and dispatcher reference.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, requireAdmin } from '@/lib/admin/auth';
import { logger } from '@/lib/logger';

// ---------------------------------------------------------------------------
// GET /api/admin — Admin API health / status
// ---------------------------------------------------------------------------

export async function GET(_request: NextRequest): Promise<NextResponse> {
  try {
    const user = await requireAdmin();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        status: 'ok',
        version: '0.1.0',
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
        },
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Admin API health check error', { error: message });
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
