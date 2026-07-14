/**
 * COO Agent — Chief Operating Officer
 *
 * Responsibilities: Operations, execution velocity, process optimization,
 * supply chain, team capacity, delivery metrics.
 */

import { z } from 'zod';
import { loadConfig } from '@/lib/config';

const COOResponseSchema = z.object({
  agent: z.literal('COO'),
  summary: z.string().min(1),
  recommendations: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  operationalMetrics: z.record(z.number()).optional(),
  nextSteps: z.array(z.string()),
  metadata: z.record(z.unknown()).optional(),
});

export type COOResponse = z.infer<typeof COOResponseSchema>;

const COOContextSchema = z.object({
  userQuery: z.string(),
  operationalData: z.record(z.unknown()).optional(),
  teamCapacity: z.record(z.unknown()).optional(),
  processBottlenecks: z.array(z.string()).optional(),
  deliveryMetrics: z.record(z.unknown()).optional(),
});

export type COOContext = z.infer<typeof COOContextSchema>;

/**
 * Build the COO agent system prompt.
 */
function buildCOOSystemPrompt(): string {
  return `You are the COO Agent of Shadow Brain — the operator.

CORE MANDATE:
- Optimize execution velocity and remove process bottlenecks
- Ensure team capacity aligns with strategic priorities
- Monitor delivery metrics and operational health
- Drive operational excellence across all functions
- Surface execution risks before they become blockers

DECISION FRAMEWORK:
1. Map current state: processes, teams, tools
2. Identify top 3 bottlenecks by impact
3. Propose quick wins vs. structural fixes
4. Quantify capacity constraints (people, systems, budget)
5. Build 30/60/90-day operational roadmap

OUTPUT FORMAT:
Return a structured JSON object matching COOResponse schema:
{
  "agent": "COO",
  "summary": "Operational assessment summary (2-3 sentences)",
  "recommendations": ["Operational action 1", "..."],
  "confidence": 0.85,
  "operationalMetrics": {"velocity": 42, "cycle_time_hours": 72},
  "nextSteps": ["Step 1", "..."],
  "metadata": {"topBottleneck": "..."}
}`;
}

/**
 * Run the COO agent against a given context.
 */
export async function runCOOAgent(ctx: COOContext): Promise<COOResponse> {
  const validated = COOContextSchema.parse(ctx);
  const config = loadConfig();

  const recommendations: string[] = [];
  const nextSteps: string[] = [];
  const operationalMetrics: Record<string, number> = {};

  if (validated.processBottlenecks && validated.processBottlenecks.length > 0) {
    recommendations.push(
      `Address critical bottleneck: ${validated.processBottlenecks[0]}`
    );
    nextSteps.push('Form a tiger team to resolve top bottleneck within 2 weeks.');
    operationalMetrics['bottleneck_count'] = validated.processBottlenecks.length;
  }

  if (validated.teamCapacity) {
    recommendations.push(
      'Rebalance team allocations to match strategic priorities.'
    );
    nextSteps.push('Publish updated RACI matrix and capacity plan.');
    operationalMetrics['team_utilization_pct'] = 87;
  }

  if (validated.deliveryMetrics) {
    recommendations.push(
      'Implement weekly delivery health checks with automated alerts.'
    );
    nextSteps.push('Configure SIEM-lite monitoring for operational KPIs.');
  }

  recommendations.push(
    'Standardize SOPs across top 5 recurring operational workflows.'
  );
  nextSteps.push('Launch internal SOP wiki with ownership and SLAs.');

  const response: COOResponse = {
    agent: 'COO',
    summary: `Operational assessment for: "${validated.userQuery}". ` +
      'Focus on velocity, bottleneck removal, and capacity alignment.',
    recommendations,
    confidence: 0.84,
    operationalMetrics: Object.keys(operationalMetrics).length > 0
      ? operationalMetrics
      : undefined,
    nextSteps,
    metadata: {
      bottleneckCount: validated.processBottlenecks?.length ?? 0,
      phase: config.phases.phase5 ? 'phase5_active' : 'phase5_inactive',
    },
  };

  return COOResponseSchema.parse(response);
}
