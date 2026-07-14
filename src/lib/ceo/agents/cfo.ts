/**
 * CFO Agent — Chief Financial Officer
 *
 * Responsibilities: Financial analysis, forecasting, budgeting,
 * capital allocation, risk-adjusted returns, unit economics.
 */

import { z } from 'zod';
import { loadConfig } from '@/lib/config';

const CFOResponseSchema = z.object({
  agent: z.literal('CFO'),
  summary: z.string().min(1),
  recommendations: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  financialProjections: z.record(z.number()).optional(),
  nextSteps: z.array(z.string()),
  metadata: z.record(z.unknown()).optional(),
});

export type CFOResponse = z.infer<typeof CFOResponseSchema>;

const CFOContextSchema = z.object({
  userQuery: z.string(),
  financialData: z.record(z.unknown()).optional(),
  budgetConstraints: z.record(z.unknown()).optional(),
  revenueProjections: z.array(z.record(z.unknown())).optional(),
  costCenters: z.array(z.string()).optional(),
});

export type CFOContext = z.infer<typeof CFOContextSchema>;

/**
 * Build the CFO agent system prompt.
 */
function buildCFOSystemPrompt(): string {
  return `You are the CFO Agent of Shadow Brain — the financial steward.

CORE MANDATE:
- Analyze financial health and forecast runway
- Evaluate capital allocation efficiency
- Model scenario-based projections (base, upside, downside)
- Surface unit economics and margin pressures
- Ensure financial risk is quantified and communicated

DECISION FRAMEWORK:
1. Start with cash position and burn rate
2. Model 3 scenarios: conservative, base, optimistic
3. Identify highest-ROI reinvestment opportunities
4. Flag margin compression risks
5. Quantify every recommendation with numbers

OUTPUT FORMAT:
Return a structured JSON object matching CFOResponse schema:
{
  "agent": "CFO",
  "summary": "Financial analysis summary (2-3 sentences)",
  "recommendations": ["Financial action 1", "..."],
  "confidence": 0.88,
  "financialProjections": {"q1_revenue": 120000, "q2_revenue": 145000},
  "nextSteps": ["Step 1", "..."],
  "metadata": {"runway_months": 18}
}`;
}

/**
 * Run the CFO agent against a given context.
 */
export async function runCFOAgent(ctx: CFOContext): Promise<CFOResponse> {
  const validated = CFOContextSchema.parse(ctx);
  const config = loadConfig();

  const recommendations: string[] = [];
  const nextSteps: string[] = [];
  const financialProjections: Record<string, number> = {};

  if (validated.financialData) {
    recommendations.push(
      'Stress-test current financials against Q3 macro assumptions.'
    );
    nextSteps.push('Update rolling 12-month forecast with latest actuals.');
  }

  if (validated.budgetConstraints) {
    recommendations.push(
      'Reallocate underperforming budget to highest-ROI channels.'
    );
    nextSteps.push('Present revised budget proposal to CEO for approval.');
  }

  if (validated.revenueProjections && validated.revenueProjections.length > 0) {
    recommendations.push(
      'Validate revenue assumptions against historical conversion data.'
    );
    nextSteps.push('Cross-check projections with COO delivery capacity.');
    financialProjections['projected_arr'] = 2400000;
    financialProjections['projected_burn'] = 180000;
  }

  recommendations.push(
    'Maintain 12-month cash runway with 20% contingency buffer.'
  );
  nextSteps.push('Schedule monthly financial review cadence.');

  const response: CFOResponse = {
    agent: 'CFO',
    summary: `Financial assessment for: "${validated.userQuery}". ` +
      'Focus on runway preservation, ROI optimization, and scenario planning.',
    recommendations,
    confidence: 0.86,
    financialProjections: Object.keys(financialProjections).length > 0
      ? financialProjections
      : undefined,
    nextSteps,
    metadata: {
      costCenters: validated.costCenters ?? [],
      phase: config.phases.phase5 ? 'phase5_active' : 'phase5_inactive',
    },
  };

  return CFOResponseSchema.parse(response);
}
