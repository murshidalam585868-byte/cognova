/**
 * Shadow Brain — Phase 4: AI Business Partner
 * Next.js API Route
 *
 * Exposes REST endpoints for the Business Partner subsystem:
 * - POST /api/partner/reason — structured reasoning
 * - POST /api/partner/sheets/* — Google Sheets operations
 * - POST /api/partner/notion/* — Notion operations
 * - POST /api/partner/crm/webhook — CRM inbound webhooks
 * - GET  /api/partner/experiments — list experiments
 * - POST /api/partner/experiments — create experiment
 * - PATCH /api/partner/experiments/:id — update experiment
 * - POST /api/partner/market-research — run market research
 *
 * All endpoints use Zod validation, structured logging, and return JSON.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { loadConfig } from '@/lib/config';

// Partner modules
import {
  ReasoningRequestSchema,
  reason,
  ReasoningResult,
} from '@/lib/partner/reasoning';

import {
  SheetRangeSchema,
  SheetWriteRequestSchema,
  SheetAppendRequestSchema,
  readRange,
  writeRange,
  appendRows,
  clearRange,
  getSpreadsheetMetadata,
} from '@/lib/partner/sheets';

import {
  CreatePageRequestSchema,
  UpdatePageRequestSchema,
  createPage,
  updatePage,
  getPage,
  listDatabases,
  queryDatabase,
  appendBlocks,
  exportMemoToNotion,
  buildBlocks,
} from '@/lib/partner/notion';

import {
  CRMWebhookPayloadSchema,
  CRMContactSchema,
  CRMDealSchema,
  parseWebhookPayload,
  handleWebhook,
  upsertContact,
  createDeal,
  searchContactsByEmail,
} from '@/lib/partner/crm';

import {
  ExperimentCreateSchema,
  ExperimentUpdateSchema,
  ExperimentListFilterSchema,
  createExperiment,
  updateExperiment,
  getExperiment,
  listExperiments,
  archiveExperiment,
  recordResult,
  getResults,
  ExperimentResultSchema,
} from '@/lib/partner/experiments';

import {
  MarketResearchQuerySchema,
  runMarketResearch,
  reportToMarkdown,
} from '@/lib/partner/market-research';

// ── Request Routing ────────────────────────────────────────────────────────

const PathSchema = z.enum([
  'reason',
  'sheets/read',
  'sheets/write',
  'sheets/append',
  'sheets/clear',
  'sheets/metadata',
  'notion/create-page',
  'notion/update-page',
  'notion/get-page',
  'notion/list-databases',
  'notion/query-database',
  'notion/append-blocks',
  'notion/export-memo',
  'crm/webhook',
  'crm/contact',
  'crm/deal',
  'crm/search',
  'experiments',
  'experiments/list',
  'experiments/results',
  'market-research',
]);

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleRequest(request, 'POST');
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handleRequest(request, 'GET');
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  return handleRequest(request, 'PATCH');
}

// ── Main Handler ───────────────────────────────────────────────────────────

async function handleRequest(request: NextRequest, method: string): Promise<NextResponse> {
  const config = loadConfig();

  // Phase 4 gate
  if (!config.phases.phase4) {
    return jsonError('Phase 4 (AI Business Partner) is not enabled.', 503);
  }

  // Extract path segment after /api/partner/
  const url = new URL(request.url);
  const rawPath = url.pathname.replace(/^\/api\/partner\/?/, '') || '';
  const pathParts = rawPath.split('/').filter(Boolean);
  const action = pathParts.join('/');

  const pathParse = PathSchema.safeParse(action || 'reason');
  if (!pathParse.success) {
    return jsonError(`Unknown path: ${action}`, 404);
  }
  const path = pathParse.data;

  logger.info('[api/partner] request', { method, path, query: url.searchParams.toString() });

  try {
    switch (path) {
      // ── Reasoning ─────────────────────────────────────────────────────
      case 'reason': {
        const body = await request.json();
        const req = ReasoningRequestSchema.parse(body);
        const result = await reason(req);
        return jsonSuccess(result);
      }

      // ── Sheets ────────────────────────────────────────────────────────
      case 'sheets/read': {
        const body = await request.json();
        const req = SheetRangeSchema.parse(body);
        const values = await readRange(req);
        return jsonSuccess({ values, range: req.range, spreadsheetId: req.spreadsheetId });
      }

      case 'sheets/write': {
        const body = await request.json();
        const req = SheetWriteRequestSchema.parse(body);
        const result = await writeRange(req);
        return jsonSuccess(result);
      }

      case 'sheets/append': {
        const body = await request.json();
        const req = SheetAppendRequestSchema.parse(body);
        const result = await appendRows(req);
        return jsonSuccess(result);
      }

      case 'sheets/clear': {
        const body = await request.json();
        const { spreadsheetId, range } = z.object({ spreadsheetId: z.string(), range: z.string() }).parse(body);
        await clearRange(spreadsheetId, range);
        return jsonSuccess({ cleared: true });
      }

      case 'sheets/metadata': {
        const body = await request.json();
        const { spreadsheetId } = z.object({ spreadsheetId: z.string() }).parse(body);
        const meta = await getSpreadsheetMetadata(spreadsheetId);
        return jsonSuccess(meta);
      }

      // ── Notion ────────────────────────────────────────────────────────
      case 'notion/create-page': {
        const body = await request.json();
        const req = CreatePageRequestSchema.parse(body);
        const page = await createPage(req);
        return jsonSuccess(page);
      }

      case 'notion/update-page': {
        const body = await request.json();
        const req = UpdatePageRequestSchema.parse(body);
        const page = await updatePage(req);
        return jsonSuccess(page);
      }

      case 'notion/get-page': {
        const body = await request.json();
        const { pageId } = z.object({ pageId: z.string() }).parse(body);
        const page = await getPage(pageId);
        return jsonSuccess(page);
      }

      case 'notion/list-databases': {
        const databases = await listDatabases();
        return jsonSuccess({ databases });
      }

      case 'notion/query-database': {
        const body = await request.json();
        const { databaseId, filter, sorts, pageSize, startCursor } = z.object({
          databaseId: z.string(),
          filter: z.record(z.unknown()).optional(),
          sorts: z.array(z.record(z.unknown())).optional(),
          pageSize: z.number().optional(),
          startCursor: z.string().optional(),
        }).parse(body);
        const result = await queryDatabase(databaseId, { filter, sorts, pageSize, startCursor });
        return jsonSuccess(result);
      }

      case 'notion/append-blocks': {
        const body = await request.json();
        const { pageId, blocks } = z.object({ pageId: z.string(), blocks: z.array(z.record(z.unknown())) }).parse(body);
        await appendBlocks(pageId, blocks);
        return jsonSuccess({ appended: true });
      }

      case 'notion/export-memo': {
        const body = await request.json();
        const { parentDatabaseId, title, memoMarkdown } = z.object({
          parentDatabaseId: z.string(),
          title: z.string(),
          memoMarkdown: z.string(),
        }).parse(body);
        const page = await exportMemoToNotion(parentDatabaseId, title, memoMarkdown);
        return jsonSuccess(page);
      }

      // ── CRM ───────────────────────────────────────────────────────────
      case 'crm/webhook': {
        const body = await request.json();
        const payload = parseWebhookPayload(body);
        const result = await handleWebhook(payload);
        return jsonSuccess(result);
      }

      case 'crm/contact': {
        const body = await request.json();
        const contact = CRMContactSchema.parse(body);
        const result = await upsertContact(contact);
        return jsonSuccess(result);
      }

      case 'crm/deal': {
        const body = await request.json();
        const deal = CRMDealSchema.parse(body);
        const result = await createDeal(deal);
        return jsonSuccess(result);
      }

      case 'crm/search': {
        const body = await request.json();
        const { email } = z.object({ email: z.string().email() }).parse(body);
        const contacts = await searchContactsByEmail(email);
        return jsonSuccess({ contacts });
      }

      // ── Experiments ───────────────────────────────────────────────────
      case 'experiments': {
        if (method === 'POST') {
          const body = await request.json();
          const req = ExperimentCreateSchema.parse(body);
          const exp = await createExperiment(req);
          return jsonSuccess(exp);
        }
        if (method === 'GET') {
          const filter = Object.fromEntries(url.searchParams.entries());
          const parsed = ExperimentListFilterSchema.parse({
            ...filter,
            page: filter.page ? Number(filter.page) : undefined,
            pageSize: filter.pageSize ? Number(filter.pageSize) : undefined,
            tags: filter.tags ? filter.tags.split(',') : undefined,
          });
          const result = await listExperiments(parsed);
          return jsonSuccess(result);
        }
        return jsonError('Method not allowed', 405);
      }

      case 'experiments/list': {
        // PATCH /api/partner/experiments/list?id=...
        if (method === 'PATCH') {
          const id = url.searchParams.get('id');
          if (!id) return jsonError('Missing id query param', 400);
          const body = await request.json();
          const req = ExperimentUpdateSchema.parse({ id, ...body });
          const exp = await updateExperiment(req);
          return jsonSuccess(exp);
        }
        // GET /api/partner/experiments/list?id=...
        if (method === 'GET') {
          const id = url.searchParams.get('id');
          if (!id) {
            const filter = Object.fromEntries(url.searchParams.entries());
            const parsed = ExperimentListFilterSchema.parse({
              ...filter,
              page: filter.page ? Number(filter.page) : undefined,
              pageSize: filter.pageSize ? Number(filter.pageSize) : undefined,
              tags: filter.tags ? filter.tags.split(',') : undefined,
            });
            const result = await listExperiments(parsed);
            return jsonSuccess(result);
          }
          const exp = await getExperiment(id);
          if (!exp) return jsonError('Experiment not found', 404);
          return jsonSuccess(exp);
        }
        return jsonError('Method not allowed', 405);
      }

      case 'experiments/results': {
        const body = await request.json();
        const result = ExperimentResultSchema.parse(body);
        await recordResult(result);
        return jsonSuccess({ recorded: true });
      }

      // ── Market Research ───────────────────────────────────────────────
      case 'market-research': {
        const body = await request.json();
        const req = MarketResearchQuerySchema.parse(body);
        const report = await runMarketResearch(req);

        // If requested, return markdown instead of JSON
        if (req.outputFormat === 'report' || req.outputFormat === 'brief') {
          const markdown = reportToMarkdown(report);
          return new NextResponse(markdown, {
            status: 200,
            headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
          });
        }

        return jsonSuccess(report);
      }

      default:
        return jsonError('Not implemented', 501);
    }
  } catch (err) {
    const message = (err as Error).message;
    logger.error('[api/partner] error', { path, method, error: message });

    if (err instanceof z.ZodError) {
      return jsonError('Validation error', 400, { issues: err.issues });
    }

    return jsonError(message, 500);
  }
}

// ── Response Helpers ───────────────────────────────────────────────────────

function jsonSuccess<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ success: true, data }, { status });
}

function jsonError(message: string, status: number, extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ success: false, error: message, ...extra }, { status });
}
