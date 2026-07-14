# ============================================================
# Cognova AI — Vercel Deployment Guide
# Domain: brain.mr-imperfect.online
# ============================================================

> **Version:** 1.0  
> **Stack:** Next.js 15 · React 19 · TypeScript · Tailwind CSS v4  
> **Platform:** Vercel (Serverless)  
> **Domain:** `brain.mr-imperfect.online`

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [External Services Setup](#external-services-setup)
3. [Project Configuration](#project-configuration)
4. [Environment Variables](#environment-variables)
5. [Domain & DNS](#domain--dns)
6. [Deploy to Vercel](#deploy-to-vercel)
7. [Post-Deploy Verification](#post-deploy-verification)
8. [Cron Jobs](#cron-jobs)
9. [Monitoring & Alerts](#monitoring--alerts)
10. [Troubleshooting](#troubleshooting)
11. [Rollback Procedure](#rollback-procedure)
12. [Reference](#reference)

---

## Prerequisites

### Accounts & Tools

| Item | Purpose | Link |
|------|---------|------|
| Vercel Account | Hosting platform | [vercel.com/signup](https://vercel.com/signup) |
| GitHub Account | Source control & CI | [github.com](https://github.com) |
| Supabase Project | PostgreSQL + Auth | [supabase.com](https://supabase.com) |
| Pinecone Index | Vector database | [pinecone.io](https://www.pinecone.io) |
| Upstash Redis | BullMQ job queues | [upstash.com](https://upstash.com) |
| OpenAI API Key | LLM inference | [platform.openai.com](https://platform.openai.com) |

### Local Tools

```bash
# Install Vercel CLI globally
npm i -g vercel@latest

# Verify installation
vercel --version
```

---

## External Services Setup

### 1. Supabase (Database + Auth)

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **Project Settings → Database → Connection string**
3. Copy the **URI** (PostgreSQL connection string)
4. Save:
   - `NEXT_PUBLIC_SUPABASE_URL` — your Supabase project URL
   - `SUPABASE_SERVICE_ROLE_KEY` — service role key (keep secret!)
5. Run the migration files from `supabase/migrations/` via the Supabase SQL Editor or CLI:
   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```

### 2. Pinecone (Vector Search)

1. Create an index at [pinecone.io](https://app.pinecone.io)
2. **Index name:** `shadow-brain` (or match `PINECONE_INDEX` env var)
3. **Dimension:** `1536` (for OpenAI `text-embedding-3-small`)
4. **Metric:** `cosine`
5. Copy your **API key** to `PINECONE_API_KEY`

### 3. Upstash Redis (Queues)

1. Create a database at [upstash.com](https://console.upstash.com)
2. Choose **Redis → Global**
3. Select region closest to Vercel (`us-east-1` / `iad1`)
4. Copy the **REDIS URL** (format: `rediss://default:...@...upstash.io:6379`)
5. Set `REDIS_URL` — note the `rediss://` (TLS) prefix

> **Why Upstash?** Vercel Functions are stateless and ephemeral. Upstash provides a serverless Redis compatible with BullMQ.

### 4. OpenAI

1. Go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Create a new project key
3. Set `OPENAI_API_KEY`
4. Ensure your account has billing enabled

---

## Project Configuration

### File Overview

The repository contains three deployment-critical files:

| File | Purpose |
|------|---------|
| `vercel.json` | Build settings, headers, rewrites, redirects, cron jobs |
| `next.config.ts` | Next.js runtime config (images, webpack, headers) |
| `package.json` | Dependencies & build scripts |

### Key `vercel.json` Settings

- **Region:** `iad1` (US East — lowest latency for Supabase US-East & Pinecone)
- **Build:** `next build` via `npm ci`
- **Headers:** Security headers (HSTS, CSP, XSS, framing, referrer)
- **Rewrites:** `/sitemap.xml` → `/api/sitemap`, `/brain` → `/dashboard`
- **Redirects:** `www` and bare domain variants → canonical `brain.mr-imperfect.online`
- **Cron:** Health check every 10 minutes to keep warm & monitor

---

## Environment Variables

### Required Variables

| Variable | Source | Scope |
|----------|--------|-------|
| `OPENAI_API_KEY` | OpenAI Platform | Server |
| `PINECONE_API_KEY` | Pinecone Console | Server |
| `PINECONE_INDEX` | Pinecone Console | Server |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Settings | Public / Server |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Settings → API | Server |
| `REDIS_URL` | Upstash Console | Server |

### Optional Variables

| Variable | Purpose |
|----------|---------|
| `LANGSMITH_API_KEY` | LangSmith tracing & observability |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Workers / R2 |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API access |
| `GMAIL_CLIENT_ID` | Gmail integration (OAuth) |
| `GMAIL_CLIENT_SECRET` | Gmail OAuth secret |
| `NOTION_TOKEN` | Notion workspace integration |
| `SLACK_WEBHOOK_URL` | Slack notifications |
| `NEXT_PUBLIC_PRODUCT_NAME` | Override brand name (default: "Cognova") |
| `NEXT_PUBLIC_TAGLINE` | Override tagline |
| `NEXT_PUBLIC_DESCRIPTION` | Override meta description |

### Feature Flags

| Variable | Default | Effect |
|----------|---------|--------|
| `ENABLE_PHASE1` | `true` | AI Assistant |
| `ENABLE_PHASE2` | `true` | Digital Shadow |
| `ENABLE_PHASE3` | `false` | Chief of Staff |
| `ENABLE_PHASE4` | `false` | AI Business Partner |
| `ENABLE_PHASE5` | `false` | AI CEO Office |

### Adding to Vercel

#### Via Dashboard (Recommended)

1. Go to [vercel.com/dashboard](https://vercel.com/dashboard)
2. Select your project → **Settings → Environment Variables**
3. Add each variable
4. Ensure `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `PINECONE_API_KEY` are marked as **Secret**

#### Via CLI

```bash
# Link project
vercel link

# Add secrets
vercel env add OPENAI_API_KEY production
vercel env add PINECONE_API_KEY production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add REDIS_URL production
vercel env add NEXT_PUBLIC_SUPABASE_URL production

# Add optional secrets
vercel env add LANGSMITH_API_KEY production
vercel env add NOTION_TOKEN production
```

#### Via GitHub Actions (CI/CD)

```yaml
# .github/workflows/deploy.yml
name: Deploy to Vercel
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: vercel/action-deploy@v1
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
```

---

## Domain & DNS

### 1. Add Domain to Vercel

```bash
vercel domains add brain.mr-imperfect.online
```

Or via Dashboard:
1. Project → **Settings → Domains**
2. Enter `brain.mr-imperfect.online`
3. Vercel provides DNS records

### 2. Configure DNS at Registrar

Log in to your domain registrar (where `mr-imperfect.online` is managed) and add:

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | brain | `76.76.21.21` | 60 |
| CNAME | www.brain | `cname.vercel-dns.com` | 60 |

> **Note:** `76.76.21.21` is Vercel's anycast IP. Verify at [vercel.com/changelog](https://vercel.com/changelog).

### 3. Verify DNS

```bash
# Check A record
dig +short brain.mr-imperfect.online
# Expected: 76.76.21.21

# Check CNAME
dig +short www.brain.mr-imperfect.online CNAME
# Expected: cname.vercel-dns.com
```

### 4. Enable HTTPS

Vercel automatically provisions and renews SSL certificates via Let's Encrypt. No manual action required.

### 5. Redirects (Already Configured)

The following redirects are active in `vercel.json`:

- `http://brain.mr-imperfect.online/*` → `https://brain.mr-imperfect.online/*`
- `www.brain.mr-imperfect.online/*` → `brain.mr-imperfect.online/*`
- `mr-imperfect.online/*` → `brain.mr-imperfect.online/*`

---

## Deploy to Vercel

### Option A: Git Integration (Recommended)

1. Push code to GitHub:
   ```bash
   git add .
   git commit -m "feat: production config for Vercel"
   git push origin main
   ```

2. Import project in Vercel:
   - [vercel.com/new](https://vercel.com/new)
   - Select your GitHub repository
   - Framework preset: **Next.js**
   - Root directory: `./`
   - Build command: `next build` (auto-detected)

3. Add environment variables (see [Environment Variables](#environment-variables))

4. Click **Deploy**

### Option B: Vercel CLI

```bash
# Login (first time only)
vercel login

# Deploy to preview
vercel

# Deploy to production
vercel --prod

# With environment variables inline (not recommended for secrets)
OPENAI_API_KEY=sk-... vercel --prod
```

### Option C: GitHub Actions (Full CI/CD)

1. Get Vercel tokens:
   ```bash
   vercel tokens create
   ```

2. Add to GitHub Secrets:
   - `VERCEL_TOKEN`
   - `VERCEL_ORG_ID` (from `vercel team list` or `.vercel/project.json`)
   - `VERCEL_PROJECT_ID` (from `.vercel/project.json`)

3. Create `.github/workflows/deploy.yml`:

```yaml
name: Vercel Production Deployment
on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install Vercel CLI
        run: npm install --global vercel@latest

      - name: Pull Vercel Environment
        run: vercel pull --yes --environment=production --token=${{ secrets.VERCEL_TOKEN }}

      - name: Build Project
        run: vercel build --prod --token=${{ secrets.VERCEL_TOKEN }}

      - name: Deploy to Production
        run: vercel deploy --prod --prebuilt --token=${{ secrets.VERCEL_TOKEN }}
```

---

## Post-Deploy Verification

### 1. Health Check

```bash
# Check deployment health
curl -s https://brain.mr-imperfect.online/api/health | jq .

# Expected response:
# {
#   "status": "healthy",
#   "version": "0.1.0",
#   "timestamp": "2025-07-14T12:00:00.000Z",
#   "services": { "app": "up", "database": "up", "redis": "up" }
# }
```

### 2. Endpoints Checklist

| Endpoint | Expected | Test |
|----------|----------|------|
| `GET /api/health` | `200 OK` JSON | ✅ |
| `GET /landing` | `200 OK` HTML | ✅ |
| `GET /dashboard` | `200 OK` HTML (or redirect) | ✅ |
| `GET /admin` | `200 OK` / `401` | ✅ |

### 3. Vercel Dashboard Checks

1. Go to [vercel.com/dashboard](https://vercel.com/dashboard) → your project
2. Verify:
   - **Domains:** `brain.mr-imperfect.online` shows ✅
   - **Functions:** No build errors
   - **Edge Config:** If using
   - **Analytics:** Real Experience Score

### 4. Lighthouse / Performance

```bash
# Install Lighthouse CLI
npm install -g lighthouse

# Run audit
lighthouse https://brain.mr-imperfect.online/landing \
  --output=html \
  --output-path=./lighthouse-report.html \
  --chrome-flags="--headless"
```

Target scores:
- Performance: ≥ 90
- Accessibility: ≥ 95
- Best Practices: ≥ 95
- SEO: ≥ 95

---

## Cron Jobs

Vercel Cron Jobs keep the platform healthy and warm.

### Configured Jobs (`vercel.json`)

```json
{
  "crons": [
    {
      "path": "/api/health",
      "schedule": "*/10 * * * *"
    }
  ]
}
```

| Job | Schedule | Purpose |
|-----|----------|---------|
| Health Ping | Every 10 min | Keep functions warm + uptime monitoring |

### Monitoring Cron Executions

1. Vercel Dashboard → **Cron Jobs**
2. View execution logs and HTTP status codes
3. Failed executions trigger alerts if configured

### Adding Custom Cron Jobs

To add a daily digest or backup trigger:

1. Create the handler:
   ```typescript
   // src/app/api/cron/daily-digest/route.ts
   import { NextResponse } from 'next/server';
   export async function GET() {
     // Your daily logic here
     return NextResponse.json({ ok: true });
   }
   ```

2. Add to `vercel.json`:
   ```json
   {
     "crons": [
       {
         "path": "/api/cron/daily-digest",
         "schedule": "0 9 * * *"
       }
     ]
   }
   ```

> **Note:** Cron jobs on Vercel have a **max execution time of 300 seconds** (Pro plan). For longer jobs, use a separate worker or queue system.

---

## Monitoring & Alerts

### Vercel Native Monitoring

1. **Analytics:** Dashboard → Analytics → Core Web Vitals
2. **Speed Insights:** Automatic real-user monitoring
3. **Logs:** Dashboard → Logs → Filter by function

### External Monitoring (Recommended)

| Tool | Purpose | Free Tier |
|------|---------|-----------|
| UptimeRobot | HTTP ping every 5 min | 50 monitors |
| Better Uptime | Status page + alerts | 10 monitors |
| Sentry | Error tracking | 5k errors/mo |

### UptimeRobot Setup

1. Sign up at [uptimerobot.com](https://uptimerobot.com)
2. Add monitor:
   - **Type:** HTTP(s)
   - **URL:** `https://brain.mr-imperfect.online/api/health`
   - **Interval:** 5 minutes
   - **Alert contact:** Email / Slack / Telegram

### Sentry Integration

```bash
npm install @sentry/nextjs
```

Create `sentry.client.config.ts` and `sentry.server.config.ts` (see Sentry docs).

---

## Troubleshooting

### Build Failures

**Error:** `Module not found: bullmq`
```
Solution: Ensure `bullmq` is in `dependencies` (not `devDependencies`).
```

**Error:** `REDIS_URL is required`
```
Solution: Add `REDIS_URL` to Vercel Environment Variables. For local dev, use `.env`.
```

**Error:** `PostCSS plugin not found`
```
Solution: Run `npm install` locally. Ensure `@tailwindcss/postcss` is in dependencies.
```

### Runtime Errors

**Error:** `Database connection timeout`
```
Cause: Supabase connection pooling limit reached.
Fix: Use connection pooling (PgBouncer) URL from Supabase:
  postgresql://...:@aws-0-us-east-1.pooler.supabase.com:6543/postgres
```

**Error:** `Redis connection refused`
```
Cause: Using `redis://` instead of `rediss://` with Upstash.
Fix: Ensure `REDIS_URL` starts with `rediss://` (TLS).
```

**Error:** `Function invocation timeout`
```
Cause: API route exceeds 10s (Hobby) or 60s (Pro).
Fix: For long-running operations, use background jobs or Edge Functions.
```

### Domain Issues

**Error:** `DNS_PROBE_FINISHED_NXDOMAIN`
```
Fix: Verify A record points to 76.76.21.21. DNS propagation can take up to 48 hours.
```

**Error:** `SSL_ERROR_BAD_CERT_DOMAIN`
```
Fix: Ensure domain is added in Vercel Dashboard → Settings → Domains.
Vercel auto-provisions certs. Wait 5-10 minutes.
```

### High Function Usage

If you exceed Vercel's function invocation limits:

1. Check **Vercel Dashboard → Usage**
2. Identify high-traffic endpoints
3. Add caching headers for static content
4. Consider Vercel Edge Functions for simple middleware
5. Upgrade plan if needed

---

## Rollback Procedure

### Immediate Rollback (Vercel Dashboard)

1. Go to [vercel.com/dashboard](https://vercel.com/dashboard) → your project
2. Click **Deployments**
3. Find the last known good deployment
4. Click the **...** menu → **Promote to Production**

### CLI Rollback

```bash
# List recent deployments
vercel ls cognova-ai

# Redeploy a specific deployment
vercel --prod --target=production <deployment-url>
```

### Git Revert

```bash
# Revert last commit
git revert HEAD

# Push to trigger new deployment
git push origin main
```

---

## Reference

### Vercel Limits (Pro Plan)

| Resource | Limit |
|----------|-------|
| Function duration | 60 seconds (300s cron) |
| Function memory | 1024 MB |
| Function concurrency | 1000 |
| Build time | 45 minutes |
| Deployments / day | 100 |
| Bandwidth | 1 TB / month |

### Directory Structure

```
shadow-brain/
├── vercel.json              # ← Vercel platform config
├── next.config.ts           # ← Next.js runtime config
├── VERCEL_DEPLOY.md         # ← This file
├── package.json
├── .env.example             # ← Template for local dev
├── .env.local               # ← Local secrets (gitignored)
├── src/
│   └── app/
│       ├── api/             # API Routes (serverless functions)
│       │   ├── health/
│       │   ├── chat/
│       │   ├── admin/
│       │   ├── billing/
│       │   ├── ceo/
│       │   ├── learning/
│       │   ├── partner/
│       │   └── upload/
│       ├── landing/
│       ├── dashboard/
│       ├── admin/
│       ├── knowledge/
│       └── billing/
├── supabase/
│   └── migrations/          # Database schema
└── workers/                 # Cloudflare Workers (optional)
```

### Useful Commands

```bash
# Pull env vars from Vercel to local
vercel env pull .env.local

# View production logs
vercel logs --production

# Inspect a specific deployment
vercel inspect <deployment-url>

# Remove project
vercel remove cognova-ai
```

### Support Links

- [Vercel Docs](https://vercel.com/docs)
- [Next.js Deployment](https://nextjs.org/docs/deployment)
- [Vercel Cron Jobs](https://vercel.com/docs/cron-jobs)
- [Supabase + Vercel](https://supabase.com/docs/guides/integrations/vercel)
- [Upstash Redis + Vercel](https://upstash.com/docs/redis/quickstarts/vercel)

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-07-14 | Initial Vercel deployment guide for brain.mr-imperfect.online |

---

*Built for production. Deploy with confidence.*
