/**
 * src/app/api/billing/route.ts
 * Billing API for Shadow Brain.
 *
 * Endpoints:
 *  POST /api/billing?op=checkout         -> Create Stripe Checkout session
 *  POST /api/billing?op=portal           -> Create Stripe Customer Portal session
 *  POST /api/billing?op=webhook          -> Stripe webhook handler (raw body)
 *  GET  /api/billing?op=subscription       -> Get current subscription + tier
 *  GET  /api/billing?op=invoices          -> List invoice history
 *  GET  /api/billing?op=usage             -> Get usage aggregates for current period
 *  POST /api/billing?op=usage             -> Record a usage event (metered billing)
 *  GET  /api/billing?op=dashboard        -> Get full billing dashboard data
 *  GET  /api/billing?op=tiers            -> List public subscription tiers
 *
 * All authenticated endpoints require userId in the request body or query.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { loadConfig } from '@/lib/config';
import { logger } from '@/lib/logger';
import {
  createCheckoutSession,
  createPortalSession,
  handleStripeWebhook,
  getSubscriptionByUser,
  getInvoicesByUser,
  getUsageAggregates,
  recordUsageEvent,
  getBillingDashboardData,
  listSubscriptionTiers,
  checkUsageLimit,
} from '@/lib/billing/stripe';

const config = loadConfig();

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

const CheckoutRequestSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email(),
  tierId: z.enum(['pro', 'enterprise']),
  returnPath: z.string().optional(),
});

const PortalRequestSchema = z.object({
  userId: z.string().uuid(),
  stripeCustomerId: z.string().min(1),
  returnPath: z.string().optional(),
});

const UsageRecordSchema = z.object({
  userId: z.string().uuid(),
  metricName: z.string().min(1),
  metricValue: z.number().min(0).default(1),
  unit: z.string().default('count'),
  source: z.string().default('api'),
  description: z.string().optional(),
});

const LimitCheckSchema = z.object({
  userId: z.string().uuid(),
  metricName: z.string().min(1),
  increment: z.number().min(1).default(1),
});

// ---------------------------------------------------------------------------
// POST Handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const operation = searchParams.get('op') ?? 'unknown';
    const body = await request.json().catch(() => ({}));

    switch (operation) {
      case 'checkout': {
        const parsed = CheckoutRequestSchema.parse(body);
        const returnPath = parsed.returnPath || '/billing';
        const successUrl = `${config.appUrl}${returnPath}?checkout=success`;
        const cancelUrl = `${config.appUrl}${returnPath}?checkout=canceled`;
        const session = await createCheckoutSession({
          userId: parsed.userId,
          email: parsed.email,
          tierId: parsed.tierId,
          successUrl,
          cancelUrl,
        });
        return NextResponse.json({ success: true, session });
      }

      case 'portal': {
        const parsed = PortalRequestSchema.parse(body);
        const returnPath = parsed.returnPath || '/billing';
        const portal = await createPortalSession({
          stripeCustomerId: parsed.stripeCustomerId,
          returnUrl: `${config.appUrl}${returnPath}`,
        });
        return NextResponse.json({ success: true, portal });
      }

      case 'usage': {
        const parsed = UsageRecordSchema.parse(body);
        const now = new Date();
        const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();
        const event = await recordUsageEvent({
          userId: parsed.userId,
          subscriptionId: null, // resolved by trigger in DB
          metricName: parsed.metricName,
          metricValue: parsed.metricValue,
          unit: parsed.unit,
          billingPeriodStart: periodStart,
          billingPeriodEnd: periodEnd,
          source: parsed.source,
          description: parsed.description ?? null,
          metadata: {},
        });
        return NextResponse.json({ success: true, event });
      }

      case 'check_limit': {
        const parsed = LimitCheckSchema.parse(body);
        const result = await checkUsageLimit({
          userId: parsed.userId,
          metricName: parsed.metricName,
          increment: parsed.increment,
        });
        return NextResponse.json({ success: true, result });
      }

      default: {
        return NextResponse.json({ error: `Unknown operation: ${operation}` }, { status: 400 });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('[API /billing] POST error', { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// GET Handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const operation = searchParams.get('op') ?? 'unknown';

    switch (operation) {
      case 'subscription': {
        const userId = searchParams.get('userId');
        if (!userId) {
          return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
        }
        const subscription = await getSubscriptionByUser(userId);
        return NextResponse.json({ success: true, subscription });
      }

      case 'invoices': {
        const userId = searchParams.get('userId');
        if (!userId) {
          return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
        }
        const limit = parseInt(searchParams.get('limit') ?? '20', 10);
        const invoices = await getInvoicesByUser(userId, limit);
        return NextResponse.json({ success: true, invoices });
      }

      case 'usage': {
        const userId = searchParams.get('userId');
        if (!userId) {
          return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
        }
        const periodStart = searchParams.get('periodStart');
        const periodEnd = searchParams.get('periodEnd');
        if (!periodStart || !periodEnd) {
          return NextResponse.json({ error: 'Missing periodStart or periodEnd' }, { status: 400 });
        }
        const usage = await getUsageAggregates(userId, periodStart, periodEnd);
        return NextResponse.json({ success: true, usage });
      }

      case 'dashboard': {
        const userId = searchParams.get('userId');
        if (!userId) {
          return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
        }
        const data = await getBillingDashboardData(userId);
        return NextResponse.json({ success: true, data });
      }

      case 'tiers': {
        const tiers = await listSubscriptionTiers();
        return NextResponse.json({ success: true, tiers });
      }

      default: {
        return NextResponse.json({ error: `Unknown operation: ${operation}` }, { status: 400 });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('[API /billing] GET error', { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Webhook Handler (requires raw body — Stripe needs exact bytes for signature)
// ---------------------------------------------------------------------------
// Usage: configure a separate route or call this from a dedicated webhook route.
// For simplicity, this module exports a standalone handler you can mount at
// /api/billing/webhook (or any path) with the bodyParser config disabled.

export async function handleWebhook(req: NextRequest): Promise<NextResponse> {
  try {
    const signature = req.headers.get('stripe-signature') ?? '';
    const payload = await req.text();
    await handleStripeWebhook(payload, signature);
    return NextResponse.json({ received: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('[API /billing/webhook] Error', { error: message });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

// ---------------------------------------------------------------------------
// OPTIONS (CORS preflight)
// ---------------------------------------------------------------------------

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
