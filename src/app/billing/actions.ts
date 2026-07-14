/**
 * src/app/billing/actions.ts
 * Server Actions for billing interactions.
 * These run on the server and can be called from client components.
 */

'use server';

import { z } from 'zod';
import { loadConfig } from '@/lib/config';
import {
  createCheckoutSession,
  createPortalSession,
  getSubscriptionByUser,
  getBillingDashboardData,
  listSubscriptionTiers,
} from '@/lib/billing/stripe';
import { logger } from '@/lib/logger';

const config = loadConfig();

const CheckoutActionSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email(),
  tierId: z.enum(['pro', 'enterprise']),
  returnPath: z.string().optional(),
});

const PortalActionSchema = z.object({
  stripeCustomerId: z.string().min(1),
  returnPath: z.string().optional(),
});

export async function startCheckout(input: z.infer<typeof CheckoutActionSchema>): Promise<{ url: string } | { error: string }> {
  try {
    const parsed = CheckoutActionSchema.parse(input);
    const returnPath = parsed.returnPath || '/billing';
    const session = await createCheckoutSession({
      userId: parsed.userId,
      email: parsed.email,
      tierId: parsed.tierId,
      successUrl: `${config.appUrl}${returnPath}?checkout=success`,
      cancelUrl: `${config.appUrl}${returnPath}?checkout=canceled`,
    });
    return { url: session.url };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('[billing/actions] startCheckout error', { error: message });
    return { error: message };
  }
}

export async function openPortal(input: z.infer<typeof PortalActionSchema>): Promise<{ url: string } | { error: string }> {
  try {
    const parsed = PortalActionSchema.parse(input);
    const returnPath = parsed.returnPath || '/billing';
    const portal = await createPortalSession({
      stripeCustomerId: parsed.stripeCustomerId,
      returnUrl: `${config.appUrl}${returnPath}`,
    });
    return { url: portal.url };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('[billing/actions] openPortal error', { error: message });
    return { error: message };
  }
}

export async function fetchBillingDashboard(userId: string) {
  try {
    return await getBillingDashboardData(userId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('[billing/actions] fetchDashboard error', { error: message, userId });
    return null;
  }
}

export async function fetchTiers() {
  try {
    return await listSubscriptionTiers();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('[billing/actions] fetchTiers error', { error: message });
    return [];
  }
}

export async function fetchSubscription(userId: string) {
  try {
    return await getSubscriptionByUser(userId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('[billing/actions] fetchSubscription error', { error: message, userId });
    return null;
  }
}
