import { z } from 'zod';

// ------------------------------------------------------------------------------
// Domain & Deployment Configuration
// ------------------------------------------------------------------------------

export const DomainConfig = z.object({
  domain: z.string().default('brain.mr-imperfect.online'),
  rootDomain: z.string().default('mr-imperfect.online'),
  protocol: z.enum(['http', 'https']).default('https'),
  appUrl: z.string().default('https://brain.mr-imperfect.online'),
  apiBase: z.string().default('https://brain.mr-imperfect.online/api'),
  workerUrl: z.string().default('https://brain.mr-imperfect.online/chief'),
  cdnUrl: z.string().optional(),
});
export type DomainConfig = z.infer<typeof DomainConfig>;

export const PhaseConfig = z.object({
  phase1: z.boolean().default(true),
  phase2: z.boolean().default(true),
  phase3: z.boolean().default(false),
  phase4: z.boolean().default(false),
  phase5: z.boolean().default(false),
});
export type PhaseConfig = z.infer<typeof PhaseConfig>;

export const BrandConfig = z.object({
  productName: z.string().default('Hazard Brain'),
  tagline: z.string().default('AI Business Partner'),
  description: z.string().default('Elite AI CEO Office System'),
  domain: z.string().default('brain.mr-imperfect.online'),
  supportEmail: z.string().default('support@mr-imperfect.online'),
});
export type BrandConfig = z.infer<typeof BrandConfig>;

export const AppConfig = z.object({
  // Domain
  domain: z.string().default('brain.mr-imperfect.online'),
  rootDomain: z.string().default('mr-imperfect.online'),
  appUrl: z.string().default('https://brain.mr-imperfect.online'),
  apiBase: z.string().default('https://brain.mr-imperfect.online/api'),

  // Core AI Providers (Required)
  openaiApiKey: z.string(),
  pineconeApiKey: z.string(),
  pineconeIndex: z.string().default('shadow-brain'),

  // Database
  supabaseUrl: z.string(),
  supabaseServiceKey: z.string(),

  // Cache & Queues
  redisUrl: z.string().optional(),

  // Observability
  langsmithApiKey: z.string().optional(),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Cloud Integrations
  cloudflareAccountId: z.string().optional(),
  cloudflareApiToken: z.string().optional(),

  // Billing
  stripeSecretKey: z.string().optional(),
  stripeProPriceId: z.string().optional(),
  stripeEnterprisePriceId: z.string().optional(),
  stripeWebhookSecret: z.string().optional(),

  // Productivity Integrations
  gmailClientId: z.string().optional(),
  gmailClientSecret: z.string().optional(),
  notionToken: z.string().optional(),
  slackWebhook: z.string().optional(),

  // Feature Phases
  phases: PhaseConfig.default({
    phase1: true,
    phase2: true,
    phase3: false,
    phase4: false,
    phase5: false,
  }),
});
export type AppConfig = z.infer<typeof AppConfig>;

// ------------------------------------------------------------------------------
// Config Loaders
// ------------------------------------------------------------------------------

export function loadDomainConfig(): DomainConfig {
  return DomainConfig.parse({
    domain: process.env.DOMAIN || 'brain.mr-imperfect.online',
    rootDomain: process.env.ROOT_DOMAIN || 'mr-imperfect.online',
    protocol: (process.env.PROTOCOL as 'http' | 'https') || 'https',
    appUrl: process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://brain.mr-imperfect.online',
    apiBase: process.env.API_BASE || process.env.NEXT_PUBLIC_API_BASE || 'https://brain.mr-imperfect.online/api',
    workerUrl: process.env.WORKER_URL || 'https://brain.mr-imperfect.online/chief',
    cdnUrl: process.env.CDN_URL || undefined,
  });
}

export function loadConfig(): AppConfig {
  return AppConfig.parse({
    domain: process.env.DOMAIN || 'brain.mr-imperfect.online',
    rootDomain: process.env.ROOT_DOMAIN || 'mr-imperfect.online',
    appUrl: process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://brain.mr-imperfect.online',
    apiBase: process.env.API_BASE || process.env.NEXT_PUBLIC_API_BASE || 'https://brain.mr-imperfect.online/api',

    openaiApiKey: process.env.OPENAI_API_KEY,
    pineconeApiKey: process.env.PINECONE_API_KEY,
    pineconeIndex: process.env.PINECONE_INDEX || 'shadow-brain',

    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,

    redisUrl: process.env.REDIS_URL,

    langsmithApiKey: process.env.LANGSMITH_API_KEY,
    logLevel: (process.env.LOG_LEVEL as AppConfig['logLevel']) || 'info',

    cloudflareAccountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    cloudflareApiToken: process.env.CLOUDFLARE_API_TOKEN,

    stripeSecretKey: process.env.STRIPE_SECRET_KEY,
    stripeProPriceId: process.env.STRIPE_PRO_PRICE_ID,
    stripeEnterprisePriceId: process.env.STRIPE_ENTERPRISE_PRICE_ID,
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,

    gmailClientId: process.env.GMAIL_CLIENT_ID,
    gmailClientSecret: process.env.GMAIL_CLIENT_SECRET,
    notionToken: process.env.NOTION_TOKEN,
    slackWebhook: process.env.SLACK_WEBHOOK_URL,

    phases: {
      phase1: process.env.ENABLE_PHASE1 !== 'false',
      phase2: process.env.ENABLE_PHASE2 === 'true',
      phase3: process.env.ENABLE_PHASE3 === 'true',
      phase4: process.env.ENABLE_PHASE4 === 'true',
      phase5: process.env.ENABLE_PHASE5 === 'true',
    },
  });
}

// ------------------------------------------------------------------------------
// Static Brand / Domain Exports (computed at import time)
// ------------------------------------------------------------------------------

export const domain = loadDomainConfig();

export const brand = BrandConfig.parse({
  productName: 'Hazard Brain',
  tagline: process.env.NEXT_PUBLIC_TAGLINE || 'AI Business Partner',
  description: process.env.NEXT_PUBLIC_DESCRIPTION || 'Elite AI CEO Office System',
  domain: process.env.DOMAIN || 'brain.mr-imperfect.online',
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'support@mr-imperfect.online',
});
  productName: process.env.NEXT_PUBLIC_PRODUCT_NAME || 'Hazard Brain',
  tagline: process.env.NEXT_PUBLIC_TAGLINE || 'AI Business Partner',
  description: process.env.NEXT_PUBLIC_DESCRIPTION || 'Elite AI CEO Office System',
  domain: process.env.DOMAIN || 'brain.mr-imperfect.online',
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'support@mr-imperfect.online',
});
