/**
 * API Route — /api/ceo
 *
 * HTTP interface for the AI CEO Office. Supports:
 * - POST /api/ceo/agents    → Run multi-agent graph
 * - POST /api/ceo/briefing  → Generate executive briefing
 * - GET  /api/ceo/briefing  → List briefings
 * - POST /api/ceo/workflow  → Start or tick a workflow
 * - POST /api/ceo/siem      → Ingest security event
 * - GET  /api/ceo/siem      → Query security events
 * - POST /api/ceo/kg        → Knowledge graph CRUD
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { loadConfig } from '@/lib/config';
import { runCSuite, runAgentSubset, type GraphState } from '@/lib/ceo/multi-agent';
import { getKnowledgeGraph } from '@/lib/ceo/knowledge-graph';
import { getWorkflowEngine } from '@/lib/ceo/workflow-engine';
import { getSIEMEngine } from '@/lib/ceo/siem';
import { getBriefingGenerator } from '@/lib/ceo/briefing';

const config = loadConfig();

// ------------------------------------------------------------------
// Request schemas
// ------------------------------------------------------------------

const AgentsRequestSchema = z.object({
  query: z.string().min(1),
  agents: z.array(z.enum(['CEO', 'CFO', 'COO', 'CTO'])).optional(),
  mode: z.enum(['parallel', 'sequential']).optional(),
  context: z.record(z.unknown()).optional(),
});

const BriefingRequestSchema = z.object({
  userId: z.string().min(1),
  type: z.enum(['daily', 'weekly', 'event', 'ad_hoc']).default('ad_hoc'),
  query: z.string().optional(),
  context: z.record(z.unknown()).optional(),
});

const WorkflowRequestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('start'),
    workflowId: z.string().uuid(),
    context: z.record(z.unknown()).optional(),
  }),
  z.object({
    action: z.literal('tick'),
    executionId: z.string().uuid(),
  }),
  z.object({
    action: z.literal('run'),
    workflowId: z.string().uuid(),
    context: z.record(z.unknown()).optional(),
  }),
]);

const SIEMIngestSchema = z.object({
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  source: z.string().min(1),
  description: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
});

const KGEntitySchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  properties: z.record(z.unknown()).optional(),
});

const KGRelationSchema = z.object({
  sourceId: z.string().uuid(),
  targetId: z.string().uuid(),
  type: z.string().min(1),
  properties: z.record(z.unknown()).optional(),
});

// ------------------------------------------------------------------
// Route handlers
// ------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Check Phase 5 flag
  if (!config.phases.phase5) {
    return NextResponse.json(
      { error: 'Phase 5 (AI CEO Office) is not enabled' },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const path = new URL(request.url).pathname;
    const searchParams = new URL(request.url).searchParams;
    const operation = searchParams.get('op') ?? body?.op;

    switch (operation) {
      case 'agents': {
        const parsed = AgentsRequestSchema.parse(body);
        let state: GraphState;
        if (parsed.agents && parsed.agents.length > 0) {
          state = await runAgentSubset(
            parsed.agents,
            parsed.query,
            parsed.context,
            parsed.mode ?? 'parallel'
          );
        } else {
          state = await runCSuite(parsed.query, parsed.context);
        }
        return NextResponse.json({ success: true, state });
      }

      case 'briefing': {
        const parsed = BriefingRequestSchema.parse(body);
        const generator = getBriefingGenerator();
        const briefing = await generator.generate(
          parsed.userId,
          parsed.type,
          parsed.query,
          parsed.context
        );
        return NextResponse.json({ success: true, briefing });
      }

      case 'workflow': {
        const parsed = WorkflowRequestSchema.parse(body);
        const engine = getWorkflowEngine();

        if (parsed.action === 'start') {
          const exec = await engine.startExecution(
            parsed.workflowId,
            parsed.context
          );
          return NextResponse.json({ success: true, execution: exec });
        }

        if (parsed.action === 'tick') {
          const exec = await engine.tick(parsed.executionId);
          return NextResponse.json({ success: true, execution: exec });
        }

        if (parsed.action === 'run') {
          const exec = await engine.runToCompletion(
            parsed.workflowId,
            parsed.context
          );
          return NextResponse.json({ success: true, execution: exec });
        }

        // Exhaustive check
        const _exhaustive: never = parsed;
        return NextResponse.json(
          { error: 'Invalid workflow action' },
          { status: 400 }
        );
      }

      case 'siem_ingest': {
        const parsed = SIEMIngestSchema.parse(body);
        const siem = getSIEMEngine();
        const event = await siem.ingestEvent(parsed);
        return NextResponse.json({ success: true, event });
      }

      case 'siem_evaluate': {
        const siem = getSIEMEngine();
        const alerts = await siem.evaluateRules();
        return NextResponse.json({ success: true, alerts });
      }

      case 'kg_entity': {
        const parsed = KGEntitySchema.parse(body);
        const kg = getKnowledgeGraph();
        const entity = await kg.createEntity(parsed);
        return NextResponse.json({ success: true, entity });
      }

      case 'kg_relation': {
        const parsed = KGRelationSchema.parse(body);
        const kg = getKnowledgeGraph();
        const relation = await kg.createRelation(parsed);
        return NextResponse.json({ success: true, relation });
      }

      default: {
        return NextResponse.json(
          { error: `Unknown operation: ${operation}` },
          { status: 400 }
        );
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[API /ceo] Error:', message);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!config.phases.phase5) {
    return NextResponse.json(
      { error: 'Phase 5 (AI CEO Office) is not enabled' },
      { status: 403 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const operation = searchParams.get('op');

    switch (operation) {
      case 'briefings': {
        const userId = searchParams.get('userId');
        if (!userId) {
          return NextResponse.json(
            { error: 'Missing userId' },
            { status: 400 }
          );
        }
        const limit = parseInt(searchParams.get('limit') ?? '20', 10);
        const generator = getBriefingGenerator();
        const briefings = await generator.listBriefings(userId, limit);
        return NextResponse.json({ success: true, briefings });
      }

      case 'siem_events': {
        const siem = getSIEMEngine();
        const events = await siem.queryEvents({
          severity: (searchParams.get('severity') as 'low' | 'medium' | 'high' | 'critical') ?? undefined,
          source: searchParams.get('source') ?? undefined,
          startTime: searchParams.get('startTime') ?? undefined,
          endTime: searchParams.get('endTime') ?? undefined,
          limit: parseInt(searchParams.get('limit') ?? '50', 10),
          offset: parseInt(searchParams.get('offset') ?? '0', 10),
        });
        return NextResponse.json({ success: true, events });
      }

      case 'siem_summary': {
        const siem = getSIEMEngine();
        const summary = await siem.getSeveritySummary({
          startTime: searchParams.get('startTime') ?? undefined,
          endTime: searchParams.get('endTime') ?? undefined,
        });
        return NextResponse.json({ success: true, summary });
      }

      case 'siem_alerts': {
        const siem = getSIEMEngine();
        const alerts = await siem.getOpenAlerts();
        return NextResponse.json({ success: true, alerts });
      }

      case 'kg_search': {
        const query = searchParams.get('q') ?? undefined;
        const type = searchParams.get('type') ?? undefined;
        const limit = parseInt(searchParams.get('limit') ?? '20', 10);
        const kg = getKnowledgeGraph();
        const entities = await kg.searchEntities({ query, type, limit });
        return NextResponse.json({ success: true, entities });
      }

      case 'kg_entity': {
        const id = searchParams.get('id');
        if (!id) {
          return NextResponse.json(
            { error: 'Missing id' },
            { status: 400 }
          );
        }
        const kg = getKnowledgeGraph();
        const entity = await kg.getEntity(id);
        if (!entity) {
          return NextResponse.json(
            { error: 'Entity not found' },
            { status: 404 }
          );
        }
        const relations = await kg.getEntityRelations(id);
        return NextResponse.json({ success: true, entity, relations });
      }

      default: {
        return NextResponse.json(
          { error: `Unknown operation: ${operation}` },
          { status: 400 }
        );
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[API /ceo] GET Error:', message);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
