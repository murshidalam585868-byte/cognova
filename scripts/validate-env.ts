#!/usr/bin/env tsx
/**
 * scripts/validate-env.ts
 * Production environment validation using Zod schemas.
 * Domain: brain.mr-imperfect.online
 * Run before deploy to ensure all required variables are set.
 */

import { z } from 'zod';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ---------------------------------------------------------------------------
// Validation Schemas
// ---------------------------------------------------------------------------

const EnvSchema = z.object({
  // Core AI
  OPENAI_API_KEY: z.string().min(10).startsWith('sk-'),
  PINECONE_API_KEY: z.string().min(10),
  PINECONE_INDEX: z.string().min(1).default('shadow-brain'),

  // Database (self-hosted or Supabase)
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().or(z.string().regex(/^http:\/\/localhost/)),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  POSTGRES_USER: z.string().min(1).default('shadowbrain'),
  POSTGRES_PASSWORD: z.string().min(8),
  POSTGRES_DB: z.string().min(1).default('shadowbrain'),

  // Redis
  REDIS_URL: z.string().regex(/^redis:\/\//).default('redis://localhost:6379'),

  // Optional: Observability
  LANGSMITH_API_KEY: z.string().min(10).optional(),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),

  // Optional: Integrations
  CLOUDFLARE_ACCOUNT_ID: z.string().uuid().optional(),
  CLOUDFLARE_API_TOKEN: z.string().min(20).optional(),
  GMAIL_CLIENT_ID: z.string().optional(),
  GMAIL_CLIENT_SECRET: z.string().optional(),
  NOTION_TOKEN: z.string().optional(),
  SLACK_WEBHOOK_URL: z.string().url().optional().or(z.literal('')),

  // Feature Phases
  ENABLE_PHASE1: z.enum(['true', 'false']).default('true'),
  ENABLE_PHASE2: z.enum(['true', 'false']).default('true'),
  ENABLE_PHASE3: z.enum(['true', 'false']).default('false'),
  ENABLE_PHASE4: z.enum(['true', 'false']).default('false'),
  ENABLE_PHASE5: z.enum(['true', 'false']).default('false'),

  // Domain & Deployment
  DOMAIN: z.string().min(1).default('brain.mr-imperfect.online'),
  ROOT_DOMAIN: z.string().min(1).default('mr-imperfect.online'),
  APP_URL: z.string().url().default('https://brain.mr-imperfect.online'),
  API_BASE: z.string().url().default('https://brain.mr-imperfect.online/api'),
  WORKER_URL: z.string().url().default('https://brain.mr-imperfect.online/chief'),
});

export type ValidatedEnv = z.infer<typeof EnvSchema>;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const envPath = resolve(process.cwd(), '.env');
  let rawEnv: Record<string, string | undefined> = { ...process.env };

  // Try to load .env file if exists
  try {
    const envContent = readFileSync(envPath, 'utf-8');
    const fileVars = envContent
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .reduce<Record<string, string>>((acc, line) => {
        const [key, ...rest] = line.split('=');
        if (key && rest.length > 0) {
          acc[key.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
        }
        return acc;
      }, {});
    rawEnv = { ...fileVars, ...rawEnv };
  } catch {
    console.warn('⚠️  .env file not found, using process.env only');
  }

  const result = EnvSchema.safeParse(rawEnv);

  if (!result.success) {
    console.error('\n❌ Environment validation failed:\n');
    const errors = result.error.errors;
    const missing = errors.filter((e) => e.message.includes('Required'));
    const invalid = errors.filter((e) => !e.message.includes('Required'));

    if (missing.length > 0) {
      console.error('Missing required variables:');
      missing.forEach((e) => console.error(`  • ${e.path.join('.')}`));
    }
    if (invalid.length > 0) {
      console.error('\nInvalid values:');
      invalid.forEach((e) => console.error(`  • ${e.path.join('.')}: ${e.message}`));
    }

    console.error('\n📋 Required variables:');
    console.error('  OPENAI_API_KEY, PINECONE_API_KEY, SUPABASE_SERVICE_ROLE_KEY, POSTGRES_PASSWORD');
    console.error('\n📋 Optional but recommended:');
    console.error('  LANGSMITH_API_KEY, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, DOMAIN');

    process.exit(1);
  }

  const env = result.data;

  console.log('\n✅ Environment validation passed\n');
  console.log('Configuration summary:');
  console.log(`  • Pinecone Index: ${env.PINECONE_INDEX}`);
  console.log(`  • Postgres DB:    ${env.POSTGRES_DB}`);
  console.log(`  • Redis URL:      ${env.REDIS_URL}`);
  console.log(`  • Log Level:      ${env.LOG_LEVEL}`);
  console.log(`  • Domain:         ${env.DOMAIN}`);
  console.log(`  • App URL:        ${env.APP_URL}`);
  console.log(`  • API Base:       ${env.API_BASE}`);
  console.log(`  • Worker URL:     ${env.WORKER_URL}`);
  console.log(`\n  Active Phases:`);
  console.log(`    Phase 1 (AI Assistant):   ${env.ENABLE_PHASE1}`);
  console.log(`    Phase 2 (Digital Shadow):   ${env.ENABLE_PHASE2}`);
  console.log(`    Phase 3 (Chief of Staff):  ${env.ENABLE_PHASE3}`);
  console.log(`    Phase 4 (AI Partner):      ${env.ENABLE_PHASE4}`);
  console.log(`    Phase 5 (AI CEO Office):   ${env.ENABLE_PHASE5}`);
  console.log();
}

main();
