/**
 * CTO Agent — Chief Technology Officer
 *
 * Responsibilities: Technology strategy, architecture decisions,
 * engineering velocity, technical debt, security posture, infrastructure.
 */

import { z } from 'zod';
import { loadConfig } from '@/lib/config';

const CTOResponseSchema = z.object({
  agent: z.literal('CTO'),
  summary: z.string().min(1),
  recommendations: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  techDebtItems: z.array(z.string()).optional(),
  architectureDecisions: z.array(z.record(z.unknown())).optional(),
  nextSteps: z.array(z.string()),
  metadata: z.record(z.unknown()).optional(),
});

export type CTOResponse = z.infer<typeof CTOResponseSchema>;

const CTOContextSchema = z.object({
  userQuery: z.string(),
  systemArchitecture: z.record(z.unknown()).optional(),
  techDebt: z.array(z.string()).optional(),
  securityPosture: z.record(z.unknown()).optional(),
  engineeringMetrics: z.record(z.unknown()).optional(),
  infrastructureStatus: z.record(z.unknown()).optional(),
});

export type CTOContext = z.infer<typeof CTOContextSchema>;

/**
 * Build the CTO agent system prompt.
 */
function buildCTOSystemPrompt(): string {
  return `You are the CTO Agent of Shadow Brain — the technical architect.

CORE MANDATE:
- Define technology roadmap aligned with business strategy
- Evaluate architecture decisions with trade-off analysis
- Monitor engineering velocity and quality metrics
- Quantify and prioritize technical debt
- Ensure security posture meets or exceeds industry standards
- Advocate for developer experience and platform reliability

DECISION FRAMEWORK:
1. Assess current architecture against 12-month growth plan
2. Identify single points of failure and scalability limits
3. Prioritize tech debt by business impact × fix effort
4. Evaluate build vs. buy vs. partner for new capabilities
5. Ensure security, compliance, and observability are first-class

OUTPUT FORMAT:
Return a structured JSON object matching CTOResponse schema:
{
  "agent": "CTO",
  "summary": "Technical assessment summary (2-3 sentences)",
  "recommendations": ["Technical action 1", "..."],
  "confidence": 0.87,
  "techDebtItems": ["Debt item 1", "..."],
  "architectureDecisions": [{"decision": "...", "rationale": "..."}],
  "nextSteps": ["Step 1", "..."],
  "metadata": {"riskLevel": "medium"}
}`;
}

/**
 * Run the CTO agent against a given context.
 */
export async function runCTOAgent(ctx: CTOContext): Promise<CTOResponse> {
  const validated = CTOContextSchema.parse(ctx);
  const config = loadConfig();

  const recommendations: string[] = [];
  const nextSteps: string[] = [];
  const techDebtItems: string[] = [...(validated.techDebt ?? [])];
  const architectureDecisions: Record<string, unknown>[] = [];

  if (validated.systemArchitecture) {
    recommendations.push(
      'Review architecture for scalability under 10× load growth.'
    );
    nextSteps.push('Schedule architecture review with engineering leads.');
    architectureDecisions.push({
      decision: 'Adopt modular microservices for core business domains',
      rationale: 'Enables independent scaling and team autonomy',
      status: 'proposed',
    });
  }

  if (validated.securityPosture) {
    recommendations.push(
      'Implement automated security scanning in CI/CD pipeline.'
    );
    nextSteps.push('Integrate SAST/DAST tools with GitHub Actions.');
  }

  if (validated.engineeringMetrics) {
    recommendations.push(
      'Set up engineering KPI dashboard with DORA metrics.'
    );
    nextSteps.push('Configure metrics collection for deployment frequency, lead time, MTTR, and change failure rate.');
  }

  // Default tech debt items if none provided
  if (techDebtItems.length === 0) {
    techDebtItems.push('Legacy authentication module needs migration');
    techDebtItems.push('Database query optimization for reporting endpoints');
  }

  recommendations.push(
    'Allocate 20% of sprint capacity to tech debt reduction.'
  );
  nextSteps.push('Create prioritized tech debt backlog with business impact scores.');

  const response: CTOResponse = {
    agent: 'CTO',
    summary: `Technical assessment for: "${validated.userQuery}". ` +
      'Focus on architecture resilience, security posture, and engineering velocity.',
    recommendations,
    confidence: 0.87,
    techDebtItems: techDebtItems.length > 0 ? techDebtItems : undefined,
    architectureDecisions: architectureDecisions.length > 0 ? architectureDecisions : undefined,
    nextSteps,
    metadata: {
      techDebtCount: techDebtItems.length,
      securityReviewNeeded: !!validated.securityPosture,
      phase: config.phases.phase5 ? 'phase5_active' : 'phase5_inactive',
    },
  };

  return CTOResponseSchema.parse(response);
}
