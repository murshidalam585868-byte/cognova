/**
 * src/types/index.ts
 * Shared TypeScript interfaces and types for Shadow Brain.
 * Extended with billing, subscription, and usage-tracking types.
 */

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface Conversation {
  id: string;
  userId: string;
  title: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  preferences: UserPreferences;
  createdAt: string;
  updatedAt: string;
}

export interface UserPreferences {
  tone: 'concise' | 'detailed' | 'technical' | 'casual';
  verbosity: 'minimal' | 'standard' | 'verbose';
  responseStyle: 'directive' | 'socratic' | 'collaborative';
  timezone: string;
  language: string;
  topicsOfInterest: string[];
  industries: string[];
}

export interface MemoryEntry {
  id: string;
  userId: string;
  namespace: string;
  content: string;
  embedding: number[];
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AgentState {
  phase: number;
  activeTools: string[];
  context: Record<string, unknown>;
  memory: MemoryEntry[];
}

export interface Task {
  id: string;
  type: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  payload: Record<string, unknown>;
  result?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Digest {
  id: string;
  userId: string;
  type: 'daily' | 'weekly' | 'event';
  content: string;
  sources: string[];
  sentAt: string;
}

export interface Entity {
  id: string;
  name: string;
  type: string;
  properties: Record<string, unknown>;
}

export interface Relation {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
  properties: Record<string, unknown>;
}

export interface Experiment {
  id: string;
  name: string;
  hypothesis: string;
  status: 'running' | 'completed' | 'cancelled';
  metrics: Record<string, number>;
  startDate: string;
  endDate?: string;
}

export interface SecurityEvent {
  id: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  source: string;
  description: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface WorkflowNode {
  id: string;
  type: string;
  config: Record<string, unknown>;
  nextNodes: string[];
}

export interface Workflow {
  id: string;
  name: string;
  nodes: WorkflowNode[];
  status: 'draft' | 'active' | 'paused';
}

// ---------------------------------------------------------------------------
// Billing & Monetization Types
// ---------------------------------------------------------------------------

/** Subscription tier: Free, Pro, or Enterprise */
export interface SubscriptionTier {
  id: 'free' | 'pro' | 'enterprise';
  name: string;
  description: string;
  stripePriceId: string | null;
  monthlyPriceCents: number;
  yearlyPriceCents: number | null;
  features: Record<string, unknown>;
  limits: SubscriptionLimits;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Feature / usage limits per tier */
export interface SubscriptionLimits {
  aiMessagesPerMonth: number;   // -1 = unlimited
  storageMb: number;            // -1 = unlimited
  maxIntegrations: number;      // -1 = unlimited
  maxTeamMembers: number;       // -1 = unlimited
}

/** Stripe-backed subscription record */
export interface Subscription {
  id: string;
  userId: string;
  tierId: SubscriptionTier['id'];
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  stripeProductId: string | null;
  status: 'incomplete' | 'incomplete_expired' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' | 'paused';
  cancelAtPeriodEnd: boolean;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  trialStart: string | null;
  trialEnd: string | null;
  canceledAt: string | null;
  endedAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** Invoice mirror from Stripe */
export interface Invoice {
  id: string;
  userId: string;
  subscriptionId: string | null;
  stripeInvoiceId: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripeChargeId: string | null;
  status: 'draft' | 'open' | 'paid' | 'uncollectible' | 'void';
  currency: string;
  amountDueCents: number;
  amountPaidCents: number;
  amountRemainingCents: number;
  invoicePdfUrl: string | null;
  invoiceNumber: string | null;
  description: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  dueDate: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** Granular usage event for metered billing */
export interface UsageEvent {
  id: string;
  userId: string;
  subscriptionId: string | null;
  metricName: string;
  metricValue: number;
  unit: string;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  source: string;
  description: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/** Pre-aggregated usage for fast limit checks */
export interface UsageAggregate {
  id: string;
  userId: string;
  subscriptionId: string | null;
  metricName: string;
  totalValue: number;
  unit: string;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  lastEventAt: string | null;
  updatedAt: string;
}

/** Billing checkout session response */
export interface CheckoutSession {
  sessionId: string;
  url: string;
}

/** Customer portal session response */
export interface PortalSession {
  url: string;
}

/** Enriched subscription with tier details for the dashboard */
export interface SubscriptionWithTier extends Subscription {
  tier: SubscriptionTier;
}

/** Billing dashboard data payload */
export interface BillingDashboardData {
  subscription: SubscriptionWithTier | null;
  invoices: Invoice[];
  usage: UsageAggregate[];
  tiers: SubscriptionTier[];
}
