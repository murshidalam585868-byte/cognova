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
  title: string;
  content: string;
  sources: string[];
  sentAt: string;
  createdAt: string;
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

/** Admin dashboard stats payload */
export interface AdminDashboardStats {
  totalUsers: number;
  totalConversations: number;
  totalMessages: number;
  totalMemories: number;
  activeUsers24h: number;
  failedJobs: number;
  openAlerts: number;
  systemStatus: 'healthy' | 'degraded' | 'critical';
}

/** Admin user view with role */
export type UserRole = 'user' | 'admin' | 'superadmin';

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  preferences: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  isActive: boolean;
}

/** System health snapshot for monitoring */
export interface SystemHealthSnapshot {
  id: string;
  cpuPercent?: number;
  memoryPercent?: number;
  diskPercent?: number;
  activeConnections?: number;
  queueDepth?: number;
  apiLatencyMs?: number;
  errorRate5m?: number;
  openAlerts?: number;
  status: 'healthy' | 'degraded' | 'critical';
  details: Record<string, unknown>;
  recordedAt: string;
}

/** Tool configuration for admin panel */
export interface ToolAdminConfig {
  id: string;
  toolName: string;
  isEnabled: boolean;
  rateLimitPerMinute: number;
  globalTimeoutMs: number;
  config: Record<string, unknown>;
  updatedBy?: string;
  updatedAt: string;
}

/** Audit log entry for security & compliance tracking */
export interface AuditLog {
  id: string;
  actorId?: string;
  actorEmail?: string;
  actorRole?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  payload?: Record<string, unknown>;
  result: 'success' | 'failure' | 'blocked';
  errorMessage?: string;
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Learning Engine Types
// ---------------------------------------------------------------------------

/** User feedback entry for a message */
export interface FeedbackEntry {
  id: string;
  userId: string;
  messageId: string;
  conversationId: string;
  feedback: 'positive' | 'negative' | 'neutral';
  rating?: number;
  comment?: string;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
}

/** Aggregated feedback statistics */
export interface FeedbackStats {
  totalFeedback: number;
  positiveCount: number;
  negativeCount: number;
  neutralCount: number;
  averageRating: number;
  positiveRate: number;
  topTags: string[];
  trendDirection: 'improving' | 'declining' | 'stable' | 'insufficient_data';
  periodStart: string;
  periodEnd: string;
}

/** A skill discovered by the learning engine */
export interface DiscoveredSkill {
  id: string;
  userId: string;
  name: string;
  description: string;
  evidence: string[];
  category: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'discovered' | 'evaluated' | 'implemented' | 'rejected';
  implementationNotes?: string;
  confidence: number;
  createdAt: string;
  updatedAt: string;
}

/** Composite learning insight for a user */
/** Uploaded document for knowledge base */
export interface Document {
  id: string;
  userId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  textContent: string;
  metadata: Record<string, unknown>;
  status: 'pending' | 'processing' | 'running' | 'completed' | 'failed';
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LearningInsight {
  userId: string;
  period: 'daily' | 'weekly' | 'monthly';
  totalConversations: number;
  totalMessages: number;
  feedbackStats: FeedbackStats;
  discoveredSkills: DiscoveredSkill[];
  topTopics: string[];
  preferenceChanges: string[];
  recommendedActions: string[];
  generatedAt: string;
}

/** Permission definition for RBAC */
export interface Permission {
  id: string;
  code: string;
  name: string;
  description: string;
  resource: string;
  action: string;
  createdAt: string;
}

/** Admin session tracking record */
export interface AdminSession {
  id: string;
  userId: string;
  sessionTokenHash: string;
  ipAddress: string | null;
  userAgent: string | null;
  expiresAt: string;
  revokedAt?: string;
  revokedReason?: string;
  createdAt: string;
}

/** Memory summary from conversation consolidation */
export interface MemorySummary {
  id: string;
  userId: string;
  conversationIds: string[];
  summary: string;
  keyFacts: string[];
  topics: string[];
  namespace: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  expiresAt?: string;
}

/** Preference snapshot captured at a point in time */
export interface PreferenceSnapshot {
  id: string;
  userId: string;
  preferences: UserPreferences;
  source: 'explicit' | 'extracted' | 'inferred';
  confidence: number;
  createdAt: string;
}

/** Individual field drift measurement */
export interface PreferenceDriftField {
  field: keyof UserPreferences;
  previousValue: unknown;
  currentValue: unknown;
  confidenceDelta: number;
  driftScore: number;
}

/** Report summarizing detected preference drift */
export interface PreferenceDriftReport {
  id: string;
  userId: string;
  snapshotIds: string[];
  driftedFields: PreferenceDriftField[];
  summary: string;
  severity: 'low' | 'medium' | 'high';
  recommendedAction: string;
  createdAt: string;
}
