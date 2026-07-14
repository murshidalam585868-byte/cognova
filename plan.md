# Shadow Brain — 39-Day Execution Roadmap (Shortcut Prototype)

**Timestamp:** 2026-07-14T13:42:02+0600  
**Architect:** L Hazard Brain (AI Business Partner & CEO Office Shortcut)  
**Infrastructure:**
- Supabase: `nywuflyutlzlluqscarc` (ap-southeast-2, Postgres 17)
- Neon: Org `org-odd-dream-72010559` (no projects yet)
- Cloudflare: Account `e07f0241cbc6535ad8dc0c96270fe7dd`

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    SHADOW BRAIN — LAYER CAKE                    │
├─────────────────────────────────────────────────────────────────┤
│ L5 │ AI CEO Office     │ LangGraph Multi-Agent │ Knowledge Graph│
│ L4 │ AI Business Partner│ Reasoning │ CRM │ Market Research     │
│ L3 │ Chief of Staff    │ Cron │ News │ BI Dashboard │ Digest     │
│ L2 │ Digital Shadow    │ Embeddings │ Style Refiner │ Memory     │
│ L1 │ AI Assistant      │ Chat │ RAG │ Tools │ Integrations      │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: AI Assistant Foundation
**Stack:** OpenAI API, LangChain.js, LangGraph, Pinecone, Postgres, Redis/BullMQ, Next.js/React, Gmail/Calendar API, LangSmith

**Deliverables:**
- Next.js 15 app with App Router (`app/`)
- LangChain.js + LangGraph chat agent with tool calling
- Pinecone vector store for RAG (knowledge base)
- Supabase Postgres for message history, user profiles, tool configs
- Redis/BullMQ queue for async job processing
- Gmail/Calendar OAuth integration
- LangSmith tracing setup

**Files:**
- `src/app/api/chat/route.ts` — Core chat endpoint
- `src/lib/agent/graph.ts` — LangGraph workflow
- `src/lib/tools/gmail.ts` — Gmail tool
- `src/lib/tools/calendar.ts` — Calendar tool
- `src/lib/vector/pinecone.ts` — Pinecone client
- `src/lib/db/supabase.ts` — Database client
- `src/lib/queue/redis.ts` — BullMQ setup
- `supabase/migrations/001_init.sql` — Schema

---

## Phase 2: Digital Shadow Self
**Stack:** Pinecone namespaces, Postgres preference tables, embedding pipelines, style refiner prompts, evaluation sets

**Deliverables:**
- User preference extraction pipeline (runs after each conversation)
- Pinecone namespace per user (`user-{id}-preferences`, `user-{id}-memory`)
- Style refiner prompt that adapts tone/verbosity to user
- Embedding pipeline for conversation summarization
- Evaluation set for shadow self quality

**Files:**
- `src/lib/shadow/extract-preferences.ts`
- `src/lib/shadow/embed-memory.ts`
- `src/lib/shadow/style-refiner.ts`
- `src/lib/shadow/evaluation.ts`
- `supabase/migrations/002_shadow.sql`

---

## Phase 3: Chief of Staff
**Stack:** Cloudflare Workers/Cron, news APIs, RSS readers, Postgres queue, Pinecone memory, BI dashboard, Slack/Telegram/email digest

**Deliverables:**
- Cloudflare Worker for scheduled intelligence gathering
- RSS/news ingestion pipeline
- Postgres-based job queue (pg-boss or similar)
- Daily digest generator (Slack/Email)
- Simple BI dashboard (Next.js + Recharts)

**Files:**
- `workers/chief-of-staff/src/index.ts` — CF Worker
- `workers/chief-of-staff/wrangler.toml`
- `src/app/dashboard/page.tsx` — BI Dashboard
- `src/lib/digest/generator.ts` — Digest engine

---

## Phase 4: AI Business Partner
**Stack:** LLM reasoning models, spreadsheet/BI integration, CRM connector, market research pipeline, experiment tracker, notion/task tools

**Deliverables:**
- Reasoning agent (o1-style chain-of-thought)
- Google Sheets / Airtable connector
- Notion API integration
- CRM webhook endpoint (HubSpot/Salesforce mock)
- Experiment tracking system
- Market research pipeline (Gildata integration)

**Files:**
- `src/lib/partner/reasoning.ts`
- `src/lib/partner/sheets.ts`
- `src/lib/partner/notion.ts`
- `src/lib/partner/crm.ts`
- `src/lib/partner/experiments.ts`
- `src/lib/partner/market-research.ts`

---

## Phase 5: AI CEO Office
**Stack:** LangGraph multi-agent graphs, Postgres knowledge graph, Pinecone namespaces, BI dashboard, workflow engine, SIEM

**Deliverables:**
- Multi-agent LangGraph (CEO, CFO, COO, CTO agents)
- Postgres knowledge graph (entities, relations, triples)
- Workflow engine state machine
- Security event ingestion (SIEM-lite)
- Executive briefing generator

**Files:**
- `src/lib/ceo/multi-agent.ts`
- `src/lib/ceo/knowledge-graph.ts`
- `src/lib/ceo/workflow-engine.ts`
- `src/lib/ceo/siem.ts`
- `src/lib/ceo/briefing.ts`
- `supabase/migrations/003_ceo_office.sql`

---

## Shared Infrastructure
- `src/lib/config.ts` — Environment & phase flags
- `src/lib/logger.ts` — Structured logging
- `src/types/index.ts` — Shared TypeScript types
- `.env.example` — Required environment variables
- `docker-compose.yml` — Local dev stack (Postgres + Redis)

---

## Execution Order
1. **Phase 1** runs first (foundation) — but we build all schemas upfront
2. **Phases 2-5** can run in parallel after Phase 1 core is scaffolded
3. **Integration** — all agents must use shared types and config
