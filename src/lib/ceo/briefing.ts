/**
 * Executive Briefing Generator
 *
 * Collates outputs from the C-suite multi-agent graph, knowledge graph,
 * SIEM, and workflow engine into a polished executive briefing.
 * Supports daily, weekly, and ad-hoc briefing formats.
 */

import { z } from 'zod';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadConfig } from '@/lib/config';
import type { Digest } from '@/types';
import { getKnowledgeGraph, type KnowledgeGraph } from './knowledge-graph';
import { getSIEMEngine, type SIEMEngine } from './siem';
import { getWorkflowEngine, type WorkflowEngine } from './workflow-engine';
import { runCSuite, type GraphState } from './multi-agent';

// ------------------------------------------------------------------
// Schemas
// ------------------------------------------------------------------

export const BriefingTypeSchema = z.enum(['daily', 'weekly', 'event', 'ad_hoc']);
export type BriefingType = z.infer<typeof BriefingTypeSchema>;

export const BriefingSectionSchema = z.object({
  title: z.string(),
  content: z.string(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  source: z.string().optional(), // e.g., "CEO Agent", "SIEM", "Knowledge Graph"
});

export type BriefingSection = z.infer<typeof BriefingSectionSchema>;

export const ExecutiveBriefingSchema = z.object({
  id: z.string().uuid(),
  userId: z.string(),
  type: BriefingTypeSchema,
  title: z.string(),
  summary: z.string(),
  sections: z.array(BriefingSectionSchema),
  generatedAt: z.string().datetime(),
  metadata: z.record(z.unknown()).default({}),
});

export type ExecutiveBriefing = z.infer<typeof ExecutiveBriefingSchema>;

// ------------------------------------------------------------------
// Briefing Generator
// ------------------------------------------------------------------

export class BriefingGenerator {
  private client: SupabaseClient;
  private kg: KnowledgeGraph;
  private siem: SIEMEngine;
  private workflowEngine: WorkflowEngine;

  constructor(opts?: {
    client?: SupabaseClient;
    kg?: KnowledgeGraph;
    siem?: SIEMEngine;
    workflowEngine?: WorkflowEngine;
  }) {
    const config = loadConfig();
    this.client = opts?.client ?? createClient(config.supabaseUrl, config.supabaseServiceKey, {
      auth: { persistSession: false },
    });
    this.kg = opts?.kg ?? getKnowledgeGraph();
    this.siem = opts?.siem ?? getSIEMEngine();
    this.workflowEngine = opts?.workflowEngine ?? getWorkflowEngine();
  }

  /**
   * Generate an executive briefing.
   *
   * @param userId The recipient user ID.
   * @param type Briefing cadence.
   * @param query Optional user query to seed the multi-agent analysis.
   * @param context Optional structured context.
   */
  async generate(
    userId: string,
    type: BriefingType,
    query?: string,
    context?: Record<string, unknown>
  ): Promise<ExecutiveBriefing> {
    const sections: BriefingSection[] = [];

    // 1. Multi-Agent Executive Summary
    let graphState: GraphState | null = null;
    if (query) {
      graphState = await runCSuite(query, context);
      if (graphState.executiveSummary) {
        sections.push({
          title: 'Executive Summary — C-Suite Analysis',
          content: graphState.executiveSummary,
          priority: 'high',
          source: 'Multi-Agent Graph',
        });
      }
      if (graphState.errors.length > 0) {
        sections.push({
          title: 'Agent Execution Errors',
          content: graphState.errors.map((e) => `- ${e}`).join('\n'),
          priority: 'medium',
          source: 'Multi-Agent Graph',
        });
      }
    }

    // 2. Security Status
    const openAlerts = await this.siem.getOpenAlerts();
    if (openAlerts.length > 0) {
      const criticalCount = openAlerts.filter((a) => a.severity === 'critical').length;
      const highCount = openAlerts.filter((a) => a.severity === 'high').length;
      sections.push({
        title: 'Security Status',
        content: `**${openAlerts.length} open alerts** — Critical: ${criticalCount}, High: ${highCount}\n\n` +
          openAlerts
            .slice(0, 5)
            .map((a) => `- [${a.severity.toUpperCase()}] ${a.message}`)
            .join('\n'),
        priority: criticalCount > 0 ? 'critical' : highCount > 0 ? 'high' : 'medium',
        source: 'SIEM',
      });
    } else {
      sections.push({
        title: 'Security Status',
        content: '✅ No open security alerts. All systems nominal.',
        priority: 'low',
        source: 'SIEM',
      });
    }

    // 3. Knowledge Graph Insights
    try {
      const recentEntities = await this.kg.searchEntities({ limit: 5 });
      if (recentEntities.length > 0) {
        sections.push({
          title: 'Recent Knowledge Graph Updates',
          content: recentEntities
            .map((e) => `- **${e.name}** (${e.type})`)
            .join('\n'),
          priority: 'medium',
          source: 'Knowledge Graph',
        });
      }
    } catch {
      // Non-fatal: knowledge graph may be empty
      sections.push({
        title: 'Knowledge Graph',
        content: 'No recent updates.',
        priority: 'low',
        source: 'Knowledge Graph',
      });
    }

    // 4. Active Workflows
    try {
      const activeWorkflows = await this.workflowEngine.listWorkflows({ status: 'active', limit: 5 });
      if (activeWorkflows.length > 0) {
        sections.push({
          title: 'Active Workflows',
          content: activeWorkflows
            .map((w) => `- **${w.name}** — ${w.nodes.length} nodes`)
            .join('\n'),
          priority: 'medium',
          source: 'Workflow Engine',
        });
      }
    } catch {
      // Non-fatal
    }

    // 5. Build final briefing
    const briefing: ExecutiveBriefing = {
      id: crypto.randomUUID(),
      userId,
      type,
      title: this.buildTitle(type, query),
      summary: this.buildSummary(sections, graphState),
      sections,
      generatedAt: new Date().toISOString(),
      metadata: {
        agentsConsulted: graphState?.completedAgents ?? [],
        alertCount: openAlerts.length,
        query,
      },
    };

    // Persist to database
    await this.saveBriefing(briefing);

    return ExecutiveBriefingSchema.parse(briefing);
  }

  /**
   * Retrieve a previously generated briefing.
   */
  async getBriefing(id: string): Promise<ExecutiveBriefing | null> {
    const { data, error } = await this.client
      .from('executive_briefings')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(`Failed to get briefing: ${error.message}`);
    }
    return ExecutiveBriefingSchema.parse(data);
  }

  /**
   * List briefings for a user.
   */
  async listBriefings(userId: string, limit = 20): Promise<ExecutiveBriefing[]> {
    const { data, error } = await this.client
      .from('executive_briefings')
      .select('*')
      .eq('user_id', userId)
      .order('generated_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(`Failed to list briefings: ${error.message}`);
    return (data ?? []).map((b) => ExecutiveBriefingSchema.parse(b));
  }

  // ------------------ Internal helpers ------------------

  private buildTitle(type: BriefingType, query?: string): string {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    switch (type) {
      case 'daily':
        return `Daily Executive Briefing — ${dateStr}`;
      case 'weekly':
        return `Weekly Executive Briefing — Week of ${dateStr}`;
      case 'event':
        return `Event Briefing — ${query ?? 'Ad-hoc'}`;
      case 'ad_hoc':
      default:
        return `Executive Briefing — ${query ?? 'General'}`;
    }
  }

  private buildSummary(sections: BriefingSection[], graphState: GraphState | null): string {
    const critical = sections.filter((s) => s.priority === 'critical').length;
    const high = sections.filter((s) => s.priority === 'high').length;
    const parts: string[] = [];

    parts.push(`This briefing contains ${sections.length} sections`);
    if (critical > 0) parts.push(`with **${critical} critical** priority item(s)`);
    if (high > 0) parts.push(`and **${high} high** priority item(s)`);
    parts.push('.');

    if (graphState?.completedAgents.length) {
      parts.push(
        ` Consulted agents: ${graphState.completedAgents.join(', ')}.`
      );
    }

    return parts.join('');
  }

  private async saveBriefing(briefing: ExecutiveBriefing): Promise<void> {
    const { error } = await this.client.from('executive_briefings').insert({
      id: briefing.id,
      user_id: briefing.userId,
      type: briefing.type,
      title: briefing.title,
      summary: briefing.summary,
      sections: briefing.sections as unknown[],
      generated_at: briefing.generatedAt,
      metadata: briefing.metadata,
    });

    if (error) throw new Error(`Failed to save briefing: ${error.message}`);
  }
}

// ------------------------------------------------------------------
// Singleton
// ------------------------------------------------------------------

let _generator: BriefingGenerator | null = null;

export function getBriefingGenerator(): BriefingGenerator {
  if (!_generator) {
    _generator = new BriefingGenerator();
  }
  return _generator;
}
