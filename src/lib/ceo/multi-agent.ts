/**
 * Multi-Agent Graph — LangGraph Orchestrator
 *
 * Orchestrates CEO, CFO, COO, and CTO agents using a state-machine
 * pattern inspired by LangGraph. Supports parallel fan-out, sequential
 * dependency chains, and conditional routing.
 */

import { z } from 'zod';
import { runCEOAgent, type CEOContext, type CEOResponse } from './agents/ceo';
import { runCFOAgent, type CFOContext, type CFOResponse } from './agents/cfo';
import { runCOOAgent, type COOContext, type COOResponse } from './agents/coo';
import { runCTOAgent, type CTOContext, type CTOResponse } from './agents/cto';

// ------------------------------------------------------------------
// Graph State
// ------------------------------------------------------------------

export const GraphStateSchema = z.object({
  query: z.string().min(1),
  context: z.record(z.unknown()).default({}),
  ceoResult: z.any().optional(),
  cfoResult: z.any().optional(),
  cooResult: z.any().optional(),
  ctoResult: z.any().optional(),
  executiveSummary: z.string().optional(),
  errors: z.array(z.string()).default([]),
  completedAgents: z.array(z.enum(['CEO', 'CFO', 'COO', 'CTO'])).default([]),
});

export type GraphState = z.infer<typeof GraphStateSchema>;

// ------------------------------------------------------------------
// Routing & Execution Plan
// ------------------------------------------------------------------

export const ExecutionPlanSchema = z.object({
  agents: z.array(z.enum(['CEO', 'CFO', 'COO', 'CTO'])),
  mode: z.enum(['parallel', 'sequential']).default('parallel'),
  dependencies: z.record(z.array(z.string())).default({}),
});

export type ExecutionPlan = z.infer<typeof ExecutionPlanSchema>;

// ------------------------------------------------------------------
// Agent Dispatch
// ------------------------------------------------------------------

/**
 * Dispatch a single agent by name with the current graph state.
 */
async function dispatchAgent(
  agentName: 'CEO' | 'CFO' | 'COO' | 'CTO',
  state: GraphState
): Promise<{
  key: 'ceoResult' | 'cfoResult' | 'cooResult' | 'ctoResult';
  result: CEOResponse | CFOResponse | COOResponse | CTOResponse;
}> {
  const baseCtx = { userQuery: state.query, ...state.context };

  switch (agentName) {
    case 'CEO': {
      const ctx: CEOContext = {
        userQuery: state.query,
        marketData: (state.context.marketData as Record<string, unknown>) ?? undefined,
        competitorIntel: (state.context.competitorIntel as Record<string, unknown>) ?? undefined,
        stakeholderUpdates: (state.context.stakeholderUpdates as Record<string, unknown>[]) ?? undefined,
        previousDecisions: (state.context.previousDecisions as Record<string, unknown>[]) ?? undefined,
      };
      const result = await runCEOAgent(ctx);
      return { key: 'ceoResult', result };
    }
    case 'CFO': {
      const ctx: CFOContext = {
        userQuery: state.query,
        financialData: (state.context.financialData as Record<string, unknown>) ?? undefined,
        budgetConstraints: (state.context.budgetConstraints as Record<string, unknown>) ?? undefined,
        revenueProjections: (state.context.revenueProjections as Record<string, unknown>[]) ?? undefined,
        costCenters: (state.context.costCenters as string[]) ?? undefined,
      };
      const result = await runCFOAgent(ctx);
      return { key: 'cfoResult', result };
    }
    case 'COO': {
      const ctx: COOContext = {
        userQuery: state.query,
        operationalData: (state.context.operationalData as Record<string, unknown>) ?? undefined,
        teamCapacity: (state.context.teamCapacity as Record<string, unknown>) ?? undefined,
        processBottlenecks: (state.context.processBottlenecks as string[]) ?? undefined,
        deliveryMetrics: (state.context.deliveryMetrics as Record<string, unknown>) ?? undefined,
      };
      const result = await runCOOAgent(ctx);
      return { key: 'cooResult', result };
    }
    case 'CTO': {
      const ctx: CTOContext = {
        userQuery: state.query,
        systemArchitecture: (state.context.systemArchitecture as Record<string, unknown>) ?? undefined,
        techDebt: (state.context.techDebt as string[]) ?? undefined,
        securityPosture: (state.context.securityPosture as Record<string, unknown>) ?? undefined,
        engineeringMetrics: (state.context.engineeringMetrics as Record<string, unknown>) ?? undefined,
        infrastructureStatus: (state.context.infrastructureStatus as Record<string, unknown>) ?? undefined,
      };
      const result = await runCTOAgent(ctx);
      return { key: 'ctoResult', result };
    }
    default: {
      // Exhaustiveness check
      const _exhaustive: never = agentName;
      throw new Error(`Unknown agent: ${_exhaustive}`);
    }
  }
}

// ------------------------------------------------------------------
// Graph Execution
// ------------------------------------------------------------------

/**
 * Compile an execution plan into a runnable graph.
 *
 * @param plan Which agents to run and in what order.
 * @returns A function that accepts initial state and returns final state.
 */
export function compileGraph(plan: ExecutionPlan) {
  const validatedPlan = ExecutionPlanSchema.parse(plan);

  return async function runGraph(initialState: GraphState): Promise<GraphState> {
    let state = GraphStateSchema.parse(initialState);

    if (validatedPlan.mode === 'parallel') {
      // Fan-out: run all agents concurrently
      const promises = validatedPlan.agents.map(async (agentName) => {
        try {
          const { key, result } = await dispatchAgent(agentName, state);
          return { key, result, agentName, error: null as string | null };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { key: null, result: null, agentName, error: message };
        }
      });

      const outcomes = await Promise.all(promises);

      for (const outcome of outcomes) {
        if (outcome.error) {
          state.errors.push(`[${outcome.agentName}] ${outcome.error}`);
        } else if (outcome.key && outcome.result) {
          (state as Record<string, unknown>)[outcome.key] = outcome.result;
          state.completedAgents.push(outcome.agentName);
        }
      }
    } else {
      // Sequential: run agents in order, updating state after each step
      for (const agentName of validatedPlan.agents) {
        // Check dependencies
        const deps = validatedPlan.dependencies[agentName] ?? [];
        const missing = deps.filter((d) => !state.completedAgents.includes(d as 'CEO' | 'CFO' | 'COO' | 'CTO'));
        if (missing.length > 0) {
          state.errors.push(
            `[${agentName}] Missing dependencies: ${missing.join(', ')}`
          );
          continue;
        }

        try {
          const { key, result } = await dispatchAgent(agentName, state);
          (state as Record<string, unknown>)[key] = result;
          state.completedAgents.push(agentName);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          state.errors.push(`[${agentName}] ${message}`);
        }
      }
    }

    // Generate executive summary from all results
    state.executiveSummary = buildExecutiveSummary(state);

    return state;
  };
}

/**
 * Build a concise executive summary from agent outputs.
 */
function buildExecutiveSummary(state: GraphState): string {
  const parts: string[] = [];
  parts.push(`## Executive Summary for: "${state.query}"`);
  parts.push('');

  if (state.ceoResult) {
    const r = state.ceoResult as CEOResponse;
    parts.push(`**CEO (${Math.round(r.confidence * 100)}% confidence):** ${r.summary}`);
    parts.push(`- Recommendations: ${r.recommendations.length}`);
  }
  if (state.cfoResult) {
    const r = state.cfoResult as CFOResponse;
    parts.push(`**CFO (${Math.round(r.confidence * 100)}% confidence):** ${r.summary}`);
    if (r.financialProjections) {
      parts.push(`- Projections: ${Object.keys(r.financialProjections).join(', ')}`);
    }
  }
  if (state.cooResult) {
    const r = state.cooResult as COOResponse;
    parts.push(`**COO (${Math.round(r.confidence * 100)}% confidence):** ${r.summary}`);
    if (r.operationalMetrics) {
      parts.push(`- Key metrics: ${Object.keys(r.operationalMetrics).join(', ')}`);
    }
  }
  if (state.ctoResult) {
    const r = state.ctoResult as CTOResponse;
    parts.push(`**CTO (${Math.round(r.confidence * 100)}% confidence):** ${r.summary}`);
    if (r.techDebtItems) {
      parts.push(`- Tech debt items: ${r.techDebtItems.length}`);
    }
  }

  if (state.errors.length > 0) {
    parts.push('');
    parts.push(`**⚠️ Errors (${state.errors.length}):**`);
    state.errors.forEach((e) => parts.push(`- ${e}`));
  }

  return parts.join('\n');
}

// ------------------------------------------------------------------
// Convenience API
// ------------------------------------------------------------------

/**
 * Run the full C-suite against a user query with optional context.
 *
 * @param query The business question or directive.
 * @param context Optional structured context for agents.
 * @returns Final graph state with all agent outputs and executive summary.
 */
export async function runCSuite(
  query: string,
  context?: Record<string, unknown>
): Promise<GraphState> {
  const plan: ExecutionPlan = {
    agents: ['CEO', 'CFO', 'COO', 'CTO'],
    mode: 'parallel',
    dependencies: {},
  };

  const graph = compileGraph(plan);
  const initialState: GraphState = {
    query,
    context: context ?? {},
    errors: [],
    completedAgents: [],
  };

  return graph(initialState);
}

/**
 * Run a subset of agents (e.g., only CEO + CFO for a financial strategy
 * question).
 */
export async function runAgentSubset(
  agents: Array<'CEO' | 'CFO' | 'COO' | 'CTO'>,
  query: string,
  context?: Record<string, unknown>,
  mode: 'parallel' | 'sequential' = 'parallel'
): Promise<GraphState> {
  const plan: ExecutionPlan = {
    agents,
    mode,
    dependencies: {},
  };

  const graph = compileGraph(plan);
  const initialState: GraphState = {
    query,
    context: context ?? {},
    errors: [],
    completedAgents: [],
  };

  return graph(initialState);
}
