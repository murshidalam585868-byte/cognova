/**
 * src/app/api/billing/webhook/route.ts
 * Stripe Webhook endpoint for Shadow Brain.
 *
 * Must be mounted at a public URL (e.g., /api/billing/webhook)
 * and registered in the Stripe Dashboard with the signing secret.
 *
 * Next.js App Router automatically provides raw body via request.text().
 */

import { NextRequest, NextResponse } from 'next/server';
import { handleStripeWebhook } from '@/lib/billing/stripe';
import { logger } from '@/lib/logger';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const signature = request.headers.get('stripe-signature') ?? '';
    const payload = await request.text();

    await handleStripeWebhook(payload, signature);
    return NextResponse.json({ received: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('[Stripe Webhook] Error', { error: message });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Stripe-Signature',
    },
  });
}
