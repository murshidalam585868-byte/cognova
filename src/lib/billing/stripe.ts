/**
 * src/lib/billing/stripe.ts
 * Stripe Billing & Monetization core for Shadow Brain.
 *
 * Responsibilities:
 * - Lazy Stripe SDK initialization
 * - Subscription tier definitions & feature gates
 * - Checkout / Portal session creation
 * - Webhook event handling with idempotency
 * - Subscription sync to Supabase
 * - Metered usage tracking & limit enforcement
 *
 * Requires: `npm install stripe` (Stripe SDK v16+)
 */

import { z } from 'zod';
import { loadConfig } from '@/lib/config';
import { logger } from '@/lib/logger';
import { getSupabaseClient } from '@/lib/db/supabase';
import type {
  Subscription,
  SubscriptionTier,
  Invoice,
  UsageEvent,
  UsageAggregate,
  CheckoutSession,
  PortalSession,
  SubscriptionWithTier,
  BillingDashboardData,
} from '@/types';

// ---------------------------------------------------------------------------
// Lazy Stripe SDK import (optional dependency)
// ---------------------------------------------------------------------------

let StripeSDK: typeof import('stripe') | null = null;
let stripeInstance: import('stripe').Stripe | null = null;

async function getStripe(): Promise<import('stripe').Stripe> {
  if (stripeInstance) return stripeInstance;

  const config = loadConfig();
  if (!config.stripeSecretKey) {
    throw new Error('Stripe is not configured. Set STRIPE_SECRET_KEY in environment.');
  }

  if (!StripeSDK) {
    try {
      StripeSDK = (await import('stripe')).default || (await import('stripe'));
    } catch {
      throw new Error('Stripe SDK is not installed. Run: npm install stripe');
    }
  }

  stripeInstance = new StripeSDK(config.stripeSecretKey, {
    apiVersion: '2024-12-18.acacia', // Use a recent stable API version; update as needed
    typescript: true,
  });

  return stripeInstance;
}

// ---------------------------------------------------------------------------
// Tier Configuration
// ---------------------------------------------------------------------------

export const TIER_FEATURES: Record<SubscriptionTier['id'], Record<string, unknown>> = {
  free: {
    ai_messages: 500,
    storage_mb: 100,
    integrations: 2,
    support: 'community',
    analytics: false,
    api_access: false,
    sso: false,
    audit_logs: false,
  },
  pro: {
    ai_messages: 10_000,
    storage_mb: 5_000,
    integrations: 10,
    support: 'email',
    analytics: true,
    api_access: true,
    sso: false,
    audit_logs: false,
  },
  enterprise: {
    ai_messages: -1, // unlimited
    storage_mb: -1,
    integrations: -1,
    support: 'dedicated',
    analytics: true,
    api_access: true,
    sso: true,
    audit_logs: true,
  },
};

export const TIER_LIMITS: Record<SubscriptionTier['id'], { aiMessagesPerMonth: number; storageMb: number; maxIntegrations: number; maxTeamMembers: number }> = {
  free: { aiMessagesPerMonth: 500, storageMb: 100, maxIntegrations: 2, maxTeamMembers: 1 },
  pro: { aiMessagesPerMonth: 10_000, storageMb: 5_000, maxIntegrations: 10, maxTeamMembers: 5 },
  enterprise: { aiMessagesPerMonth: -1, storageMb: -1, maxIntegrations: -1, maxTeamMembers: -1 },
};

export const TIER_PRICES: Record<SubscriptionTier['id'], { monthlyCents: number; yearlyCents: number | null }> = {
  free: { monthlyCents: 0, yearlyCents: null },
  pro: { monthlyCents: 2_900, yearlyCents: 29_000 },
  enterprise: { monthlyCents: 0, yearlyCents: null },
};

// ---------------------------------------------------------------------------
// Supabase DB Helpers (billing-specific)
// ---------------------------------------------------------------------------

export async function getSubscriptionTier(tierId: string): Promise<SubscriptionTier | null> {
  const sb = getSupabaseClient();
  const { data, error } = await sb.from('subscription_tiers').select('*').eq('id', tierId).single();
  if (error) {
    if (error.code === 'PGRST116') return null;
    logger.error('Failed to get subscription tier', { error, tierId });
    throw new Error(`DB error: ${error.message}`);
  }
  return mapSubscriptionTier(data);
}

export async function listSubscriptionTiers(): Promise<SubscriptionTier[]> {
  const sb = getSupabaseClient();
  const { data, error } = await sb.from('subscription_tiers').select('*').eq('is_active', true).order('monthly_price_cents', { ascending: true });
  if (error) {
    logger.error('Failed to list subscription tiers', { error });
    throw new Error(`DB error: ${error.message}`);
  }
  return (data || []).map(mapSubscriptionTier);
}

export async function getSubscriptionByUser(userId: string): Promise<SubscriptionWithTier | null> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('subscriptions')
    .select('*, tier:subscription_tiers(*)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    logger.error('Failed to get subscription by user', { error, userId });
    throw new Error(`DB error: ${error.message}`);
  }

  const subscription = mapSubscription(data);
  const tier = mapSubscriptionTier(data.tier);
  return { ...subscription, tier };
}

export async function getSubscriptionByStripeId(stripeSubscriptionId: string): Promise<Subscription | null> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('subscriptions')
    .select('*')
    .eq('stripe_subscription_id', stripeSubscriptionId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    logger.error('Failed to get subscription by stripe id', { error, stripeSubscriptionId });
    throw new Error(`DB error: ${error.message}`);
  }

  return mapSubscription(data);
}

export async function upsertSubscription(subscription: Partial<Subscription> & { userId: string; tierId: string }): Promise<Subscription> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('subscriptions')
    .upsert({
      user_id: subscription.userId,
      tier_id: subscription.tierId,
      stripe_customer_id: subscription.stripeCustomerId ?? null,
      stripe_subscription_id: subscription.stripeSubscriptionId ?? null,
      stripe_price_id: subscription.stripePriceId ?? null,
      stripe_product_id: subscription.stripeProductId ?? null,
      status: subscription.status ?? 'incomplete',
      cancel_at_period_end: subscription.cancelAtPeriodEnd ?? false,
      current_period_start: subscription.currentPeriodStart ?? null,
      current_period_end: subscription.currentPeriodEnd ?? null,
      trial_start: subscription.trialStart ?? null,
      trial_end: subscription.trialEnd ?? null,
      canceled_at: subscription.canceledAt ?? null,
      ended_at: subscription.endedAt ?? null,
      metadata: subscription.metadata ?? {},
    }, { onConflict: 'stripe_subscription_id' })
    .select()
    .single();

  if (error) {
    logger.error('Failed to upsert subscription', { error, userId: subscription.userId });
    throw new Error(`DB error: ${error.message}`);
  }

  return mapSubscription(data);
}

export async function getInvoicesByUser(userId: string, limit = 20): Promise<Invoice[]> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('invoices')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    logger.error('Failed to get invoices', { error, userId });
    throw new Error(`DB error: ${error.message}`);
  }

  return (data || []).map(mapInvoice);
}

export async function upsertInvoice(invoice: Partial<Invoice> & { userId: string }): Promise<Invoice> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('invoices')
    .upsert({
      user_id: invoice.userId,
      subscription_id: invoice.subscriptionId ?? null,
      stripe_invoice_id: invoice.stripeInvoiceId ?? null,
      stripe_customer_id: invoice.stripeCustomerId ?? null,
      stripe_subscription_id: invoice.stripeSubscriptionId ?? null,
      stripe_charge_id: invoice.stripeChargeId ?? null,
      status: invoice.status ?? 'draft',
      currency: invoice.currency ?? 'usd',
      amount_due_cents: invoice.amountDueCents ?? 0,
      amount_paid_cents: invoice.amountPaidCents ?? 0,
      amount_remaining_cents: invoice.amountRemainingCents ?? 0,
      invoice_pdf_url: invoice.invoicePdfUrl ?? null,
      invoice_number: invoice.invoiceNumber ?? null,
      description: invoice.description ?? null,
      period_start: invoice.periodStart ?? null,
      period_end: invoice.periodEnd ?? null,
      due_date: invoice.dueDate ?? null,
      metadata: invoice.metadata ?? {},
    }, { onConflict: 'stripe_invoice_id' })
    .select()
    .single();

  if (error) {
    logger.error('Failed to upsert invoice', { error, userId: invoice.userId });
    throw new Error(`DB error: ${error.message}`);
  }

  return mapInvoice(data);
}

export async function recordUsageEvent(event: Omit<UsageEvent, 'id' | 'createdAt'>): Promise<UsageEvent> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('usage_tracking')
    .insert({
      user_id: event.userId,
      subscription_id: event.subscriptionId ?? null,
      metric_name: event.metricName,
      metric_value: event.metricValue,
      unit: event.unit,
      billing_period_start: event.billingPeriodStart,
      billing_period_end: event.billingPeriodEnd,
      source: event.source,
      description: event.description,
      metadata: event.metadata ?? {},
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to record usage event', { error, userId: event.userId, metric: event.metricName });
    throw new Error(`DB error: ${error.message}`);
  }

  return mapUsageEvent(data);
}

export async function getUsageAggregates(userId: string, billingPeriodStart: string, billingPeriodEnd: string): Promise<UsageAggregate[]> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('usage_aggregates')
    .select('*')
    .eq('user_id', userId)
    .eq('billing_period_start', billingPeriodStart)
    .eq('billing_period_end', billingPeriodEnd);

  if (error) {
    logger.error('Failed to get usage aggregates', { error, userId });
    throw new Error(`DB error: ${error.message}`);
  }

  return (data || []).map(mapUsageAggregate);
}

export async function getBillingDashboardData(userId: string): Promise<BillingDashboardData> {
  const [subscription, tiers, invoices] = await Promise.all([
    getSubscriptionByUser(userId).catch(() => null),
    listSubscriptionTiers(),
    getInvoicesByUser(userId, 50).catch(() => []),
  ]);

  const periodStart = subscription?.currentPeriodStart ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const periodEnd = subscription?.currentPeriodEnd ?? new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString();

  const usage = await getUsageAggregates(userId, periodStart, periodEnd).catch(() => []);

  return { subscription, tiers, invoices, usage };
}

// ---------------------------------------------------------------------------
// Stripe Checkout & Portal
// ---------------------------------------------------------------------------

export async function createCheckoutSession({
  userId,
  email,
  tierId,
  successUrl,
  cancelUrl,
}: {
  userId: string;
  email: string;
  tierId: 'pro' | 'enterprise';
  successUrl: string;
  cancelUrl: string;
}): Promise<CheckoutSession> {
  const stripe = await getStripe();
  const config = loadConfig();

  const priceId = tierId === 'pro'
    ? config.stripeProPriceId
    : config.stripeEnterprisePriceId;

  if (!priceId) {
    throw new Error(`Stripe price ID not configured for tier: ${tierId}`);
  }

  // Create or retrieve Stripe customer
  const customer = await stripe.customers.create({
    email,
    metadata: { user_id: userId, app: 'shadow-brain' },
  });

  const session = await stripe.checkout.sessions.create({
    customer: customer.id,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    subscription_data: {
      metadata: { user_id: userId, tier_id: tierId },
    },
    metadata: { user_id: userId, tier_id: tierId },
  });

  if (!session.url) {
    throw new Error('Stripe checkout session did not return a URL');
  }

  logger.info('Checkout session created', { sessionId: session.id, userId, tierId });
  return { sessionId: session.id, url: session.url };
}

export async function createPortalSession({
  stripeCustomerId,
  returnUrl,
}: {
  stripeCustomerId: string;
  returnUrl: string;
}): Promise<PortalSession> {
  const stripe = await getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: returnUrl,
  });

  if (!session.url) {
    throw new Error('Stripe portal session did not return a URL');
  }

  logger.info('Portal session created', { stripeCustomerId });
  return { url: session.url };
}

// ---------------------------------------------------------------------------
// Webhook Handling
// ---------------------------------------------------------------------------

const WebhookEventSchema = z.object({
  id: z.string(),
  object: z.literal('event'),
  type: z.string(),
  data: z.object({
    object: z.record(z.unknown()),
  }),
});

export async function handleStripeWebhook(payload: string | Buffer, signature: string): Promise<{ received: true }> {
  const stripe = await getStripe();
  const config = loadConfig();

  if (!config.stripeWebhookSecret) {
    throw new Error('Stripe webhook secret is not configured');
  }

  let event: import('stripe').Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature, config.stripeWebhookSecret);
  } catch (err) {
    logger.warn('Invalid Stripe webhook signature', { error: (err as Error).message });
    throw new Error('Invalid signature');
  }

  const parsed = WebhookEventSchema.parse({
    id: event.id,
    object: 'event',
    type: event.type,
    data: { object: event.data.object as Record<string, unknown> },
  });

  logger.info('Stripe webhook received', { eventId: parsed.id, type: parsed.type });

  switch (parsed.type) {
    case 'checkout.session.completed': {
      await handleCheckoutSessionCompleted(event.data.object as import('stripe').Stripe.Checkout.Session);
      break;
    }
    case 'invoice.payment_succeeded': {
      await handleInvoicePaymentSucceeded(event.data.object as import('stripe').Stripe.Invoice);
      break;
    }
    case 'invoice.payment_failed': {
      await handleInvoicePaymentFailed(event.data.object as import('stripe').Stripe.Invoice);
      break;
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.created': {
      await handleSubscriptionUpdated(event.data.object as import('stripe').Stripe.Subscription);
      break;
    }
    case 'customer.subscription.deleted': {
      await handleSubscriptionDeleted(event.data.object as import('stripe').Stripe.Subscription);
      break;
    }
    default: {
      logger.info('Unhandled Stripe webhook event type', { type: parsed.type });
    }
  }

  return { received: true };
}

async function handleCheckoutSessionCompleted(session: import('stripe').Stripe.Checkout.Session) {
  const userId = session.metadata?.user_id as string | undefined;
  const tierId = session.metadata?.tier_id as string | undefined;
  if (!userId || !tierId) {
    logger.warn('Checkout session missing metadata', { sessionId: session.id });
    return;
  }

  const stripe = await getStripe();
  const subscription = await stripe.subscriptions.retrieve(session.subscription as string);

  await upsertSubscription({
    userId,
    tierId: tierId as Subscription['tierId'],
    stripeCustomerId: session.customer as string,
    stripeSubscriptionId: subscription.id,
    stripePriceId: subscription.items.data[0]?.price.id ?? null,
    stripeProductId: subscription.items.data[0]?.price.product as string | null ?? null,
    status: subscription.status as Subscription['status'],
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    currentPeriodStart: new Date(subscription.current_period_start * 1000).toISOString(),
    currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
    trialStart: subscription.trial_start ? new Date(subscription.trial_start * 1000).toISOString() : null,
    trialEnd: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
    metadata: { checkoutSessionId: session.id },
  });

  logger.info('Subscription synced from checkout', { userId, tierId, subscriptionId: subscription.id });
}

async function handleInvoicePaymentSucceeded(stripeInvoice: import('stripe').Stripe.Invoice) {
  if (!stripeInvoice.customer) return;

  const stripe = await getStripe();
  const customer = await stripe.customers.retrieve(stripeInvoice.customer as string);
  const userId = (customer as import('stripe').Stripe.Customer).metadata?.user_id as string | undefined;
  if (!userId) {
    logger.warn('Invoice missing customer user_id metadata', { invoiceId: stripeInvoice.id });
    return;
  }

  await upsertInvoice({
    userId,
    stripeInvoiceId: stripeInvoice.id,
    stripeCustomerId: stripeInvoice.customer as string,
    stripeSubscriptionId: stripeInvoice.subscription as string | null,
    stripeChargeId: stripeInvoice.charge as string | null,
    status: 'paid',
    currency: stripeInvoice.currency,
    amountDueCents: stripeInvoice.amount_due,
    amountPaidCents: stripeInvoice.amount_paid,
    amountRemainingCents: stripeInvoice.amount_remaining ?? 0,
    invoicePdfUrl: stripeInvoice.invoice_pdf,
    invoiceNumber: stripeInvoice.number,
    description: stripeInvoice.description,
    periodStart: stripeInvoice.period_start ? new Date(stripeInvoice.period_start * 1000).toISOString() : null,
    periodEnd: stripeInvoice.period_end ? new Date(stripeInvoice.period_end * 1000).toISOString() : null,
    dueDate: stripeInvoice.due_date ? new Date(stripeInvoice.due_date * 1000).toISOString() : null,
  });

  logger.info('Invoice payment succeeded', { invoiceId: stripeInvoice.id, userId });
}

async function handleInvoicePaymentFailed(stripeInvoice: import('stripe').Stripe.Invoice) {
  if (!stripeInvoice.customer) return;

  const stripe = await getStripe();
  const customer = await stripe.customers.retrieve(stripeInvoice.customer as string);
  const userId = (customer as import('stripe').Stripe.Customer).metadata?.user_id as string | undefined;
  if (!userId) return;

  await upsertInvoice({
    userId,
    stripeInvoiceId: stripeInvoice.id,
    stripeCustomerId: stripeInvoice.customer as string,
    stripeSubscriptionId: stripeInvoice.subscription as string | null,
    status: 'open',
    currency: stripeInvoice.currency,
    amountDueCents: stripeInvoice.amount_due,
    amountPaidCents: stripeInvoice.amount_paid,
    amountRemainingCents: stripeInvoice.amount_remaining ?? 0,
    invoicePdfUrl: stripeInvoice.invoice_pdf,
    invoiceNumber: stripeInvoice.number,
    description: stripeInvoice.description,
  });

  logger.warn('Invoice payment failed', { invoiceId: stripeInvoice.id, userId });
}

async function handleSubscriptionUpdated(stripeSubscription: import('stripe').Stripe.Subscription) {
  const customerId = stripeSubscription.customer as string;
  const stripe = await getStripe();
  const customer = await stripe.customers.retrieve(customerId);
  const userId = (customer as import('stripe').Stripe.Customer).metadata?.user_id as string | undefined;
  if (!userId) {
    logger.warn('Subscription update missing customer user_id', { subscriptionId: stripeSubscription.id });
    return;
  }

  const tierId = stripeSubscription.metadata?.tier_id as string | undefined;
  if (!tierId) {
    logger.warn('Subscription update missing tier_id metadata', { subscriptionId: stripeSubscription.id });
    return;
  }

  await upsertSubscription({
    userId,
    tierId: tierId as Subscription['tierId'],
    stripeCustomerId: customerId,
    stripeSubscriptionId: stripeSubscription.id,
    stripePriceId: stripeSubscription.items.data[0]?.price.id ?? null,
    stripeProductId: stripeSubscription.items.data[0]?.price.product as string | null ?? null,
    status: stripeSubscription.status as Subscription['status'],
    cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
    currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000).toISOString(),
    currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000).toISOString(),
    trialStart: stripeSubscription.trial_start ? new Date(stripeSubscription.trial_start * 1000).toISOString() : null,
    trialEnd: stripeSubscription.trial_end ? new Date(stripeSubscription.trial_end * 1000).toISOString() : null,
    canceledAt: stripeSubscription.canceled_at ? new Date(stripeSubscription.canceled_at * 1000).toISOString() : null,
    endedAt: stripeSubscription.ended_at ? new Date(stripeSubscription.ended_at * 1000).toISOString() : null,
  });

  logger.info('Subscription updated from webhook', { subscriptionId: stripeSubscription.id, userId, status: stripeSubscription.status });
}

async function handleSubscriptionDeleted(stripeSubscription: import('stripe').Stripe.Subscription) {
  const customerId = stripeSubscription.customer as string;
  const stripe = await getStripe();
  const customer = await stripe.customers.retrieve(customerId);
  const userId = (customer as import('stripe').Stripe.Customer).metadata?.user_id as string | undefined;
  if (!userId) return;

  const existing = await getSubscriptionByStripeId(stripeSubscription.id);
  if (!existing) return;

  const sb = getSupabaseClient();
  await sb
    .from('subscriptions')
    .update({ status: 'canceled', ended_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('stripe_subscription_id', stripeSubscription.id);

  logger.info('Subscription canceled from webhook', { subscriptionId: stripeSubscription.id, userId });
}

// ---------------------------------------------------------------------------
// Limit Enforcement
// ---------------------------------------------------------------------------

export async function checkUsageLimit({
  userId,
  metricName,
  increment = 1,
}: {
  userId: string;
  metricName: string;
  increment?: number;
}): Promise<{ allowed: boolean; current: number; limit: number; tierId: string }> {
  const subscription = await getSubscriptionByUser(userId);
  const tierId = subscription?.tierId ?? 'free';
  const limits = TIER_LIMITS[tierId];
  const limit = (limits as Record<string, number>)[metricName] ?? -1;

  if (limit === -1) {
    return { allowed: true, current: 0, limit: -1, tierId };
  }

  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();

  const aggregates = await getUsageAggregates(userId, periodStart, periodEnd);
  const agg = aggregates.find((a) => a.metricName === metricName);
  const current = agg ? Number(agg.totalValue) : 0;

  if (current + increment > limit) {
    return { allowed: false, current, limit, tierId };
  }

  return { allowed: true, current, limit, tierId };
}

export async function incrementUsage({
  userId,
  metricName,
  value = 1,
  unit = 'count',
  source = 'api',
  description,
}: {
  userId: string;
  metricName: string;
  value?: number;
  unit?: string;
  source?: string;
  description?: string;
}): Promise<void> {
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();

  const subscription = await getSubscriptionByUser(userId).catch(() => null);

  await recordUsageEvent({
    userId,
    subscriptionId: subscription?.id ?? null,
    metricName,
    metricValue: value,
    unit,
    billingPeriodStart: periodStart,
    billingPeriodEnd: periodEnd,
    source,
    description: description ?? null,
    metadata: {},
  });
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapSubscription(row: Record<string, unknown>): Subscription {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    tierId: row.tier_id as Subscription['tierId'],
    stripeCustomerId: row.stripe_customer_id ? String(row.stripe_customer_id) : null,
    stripeSubscriptionId: row.stripe_subscription_id ? String(row.stripe_subscription_id) : null,
    stripePriceId: row.stripe_price_id ? String(row.stripe_price_id) : null,
    stripeProductId: row.stripe_product_id ? String(row.stripe_product_id) : null,
    status: row.status as Subscription['status'],
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    currentPeriodStart: row.current_period_start ? String(row.current_period_start) : null,
    currentPeriodEnd: row.current_period_end ? String(row.current_period_end) : null,
    trialStart: row.trial_start ? String(row.trial_start) : null,
    trialEnd: row.trial_end ? String(row.trial_end) : null,
    canceledAt: row.canceled_at ? String(row.canceled_at) : null,
    endedAt: row.ended_at ? String(row.ended_at) : null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapSubscriptionTier(row: Record<string, unknown>): SubscriptionTier {
  return {
    id: row.id as SubscriptionTier['id'],
    name: String(row.name),
    description: String(row.description),
    stripePriceId: row.stripe_price_id ? String(row.stripe_price_id) : null,
    monthlyPriceCents: Number(row.monthly_price_cents ?? 0),
    yearlyPriceCents: row.yearly_price_cents ? Number(row.yearly_price_cents) : null,
    features: (row.features as Record<string, unknown>) ?? {},
    limits: (row.limits as SubscriptionTier['limits']) ?? {
      aiMessagesPerMonth: -1,
      storageMb: -1,
      maxIntegrations: -1,
      maxTeamMembers: -1,
    },
    isActive: Boolean(row.is_active ?? true),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapInvoice(row: Record<string, unknown>): Invoice {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    subscriptionId: row.subscription_id ? String(row.subscription_id) : null,
    stripeInvoiceId: row.stripe_invoice_id ? String(row.stripe_invoice_id) : null,
    stripeCustomerId: row.stripe_customer_id ? String(row.stripe_customer_id) : null,
    stripeSubscriptionId: row.stripe_subscription_id ? String(row.stripe_subscription_id) : null,
    stripeChargeId: row.stripe_charge_id ? String(row.stripe_charge_id) : null,
    status: row.status as Invoice['status'],
    currency: String(row.currency ?? 'usd'),
    amountDueCents: Number(row.amount_due_cents ?? 0),
    amountPaidCents: Number(row.amount_paid_cents ?? 0),
    amountRemainingCents: Number(row.amount_remaining_cents ?? 0),
    invoicePdfUrl: row.invoice_pdf_url ? String(row.invoice_pdf_url) : null,
    invoiceNumber: row.invoice_number ? String(row.invoice_number) : null,
    description: row.description ? String(row.description) : null,
    periodStart: row.period_start ? String(row.period_start) : null,
    periodEnd: row.period_end ? String(row.period_end) : null,
    dueDate: row.due_date ? String(row.due_date) : null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapUsageEvent(row: Record<string, unknown>): UsageEvent {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    subscriptionId: row.subscription_id ? String(row.subscription_id) : null,
    metricName: String(row.metric_name),
    metricValue: Number(row.metric_value ?? 0),
    unit: String(row.unit ?? 'count'),
    billingPeriodStart: String(row.billing_period_start),
    billingPeriodEnd: String(row.billing_period_end),
    source: String(row.source ?? 'api'),
    description: row.description ? String(row.description) : null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: String(row.created_at),
  };
}

function mapUsageAggregate(row: Record<string, unknown>): UsageAggregate {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    subscriptionId: row.subscription_id ? String(row.subscription_id) : null,
    metricName: String(row.metric_name),
    totalValue: Number(row.total_value ?? 0),
    unit: String(row.unit ?? 'count'),
    billingPeriodStart: String(row.billing_period_start),
    billingPeriodEnd: String(row.billing_period_end),
    lastEventAt: row.last_event_at ? String(row.last_event_at) : null,
    updatedAt: String(row.updated_at),
  };
}
