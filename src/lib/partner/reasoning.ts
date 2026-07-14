/**
 * Shadow Brain — Phase 4: AI Business Partner
 * Reasoning Engine
 *
 * A structured reasoning layer that wraps LLM calls with chain-of-thought,
 * self-critique, and multi-step reasoning. Supports o1-style reasoning
 * patterns with fallback to standard GPT-4 for structured output.
 */

import { z } from 'zod';
import { OpenAI } from 'openai';
import { loadConfig } from '@/lib/config';
import { logger } from '@/lib/logger';

// ── Zod Schemas ────────────────────────────────────────────────────────────

export const ReasoningStepSchema = z.object({
  stepNumber: z.number().int().positive(),
  title: z.string().min(1),
  reasoning: z.string().min(1),
  confidence: z.number().min(0).max(1).default(0.85),
  evidence: z.array(z.string()).optional().default([]),
});
export type ReasoningStep = z.infer<typeof ReasoningStepSchema>;

export const ReasoningResultSchema = z.object({
  query: z.string().min(1),
  steps: z.array(ReasoningStepSchema),
  conclusion: z.string().min(1),
  confidence: z.number().min(0).max(1),
  caveats: z.array(z.string()).optional().default([]),
  actionItems: z.array(z.string()).optional().default([]),
  metadata: z.record(z.unknown()).optional().default({}),
});
export type ReasoningResult = z.infer<typeof ReasoningResultSchema>;

export const ReasoningRequestSchema = z.object({
  query: z.string().min(1),
  context: z.string().optional(),
  mode: z.enum(['fast', 'deep', 'critique']).default('deep'),
  maxSteps: z.number().int().min(1).max(10).default(5),
  temperature: z.number().min(0).max(2).default(0.3),
  model: z.string().optional(), // e.g. 'o1-preview', 'gpt-4o'
});
export type ReasoningRequest = z.infer<typeof ReasoningRequestSchema>;

export const CritiqueResultSchema = z.object({
  valid: z.boolean(),
  flaws: z.array(z.string()),
  improvements: z.array(z.string()),
  revisedConclusion: z.string().optional(),
});
export type CritiqueResult = z.infer<typeof CritiqueResultSchema>;

// ── OpenAI Client ────────────────────────────────────────────────────────

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    const config = loadConfig();
    _openai = new OpenAI({ apiKey: config.openaiApiKey });
  }
  return _openai;
}

// ── Prompt Builders ───────────────────────────────────────────────────────

function buildSystemPrompt(mode: ReasoningRequest['mode'], maxSteps: number): string {
  const base = `You are Shadow Brain's reasoning engine — an elite AI business partner that thinks step-by-step before concluding.`;

  const modePrompts: Record<typeof mode, string> = {
    fast: `${base} Respond quickly with 2-3 concise reasoning steps. Prioritize speed over depth.`,
    deep: `${base} Perform thorough, multi-step reasoning (${maxSteps} steps). Explore multiple angles, weigh trade-offs, and cite evidence. Acknowledge uncertainty.`,
    critique: `${base} First reason deeply, then apply a self-critique pass: identify flaws, biases, and missing perspectives. Revise your conclusion if needed.`,
  };

  return modePrompts[mode];
}

function buildUserPrompt(req: ReasoningRequest): string {
  const parts: string[] = [
    `## Query\n${req.query}`,
  ];
  if (req.context) {
    parts.push(`\n## Context\n${req.context}`);
  }
  parts.push(`\n## Instructions
Think step-by-step. Return a JSON object with:
- query: the original query
- steps: array of reasoning steps (stepNumber, title, reasoning, confidence, evidence[])
- conclusion: final synthesized conclusion
- confidence: overall confidence 0-1
- caveats: array of limitations or caveats
- actionItems: array of concrete next steps
- metadata: any extra structured data`);
  return parts.join('\n');
}

// ── Core Reasoning Engine ─────────────────────────────────────────────────

/**
 * Execute structured reasoning on a business query.
 * Uses the configured LLM (defaults to gpt-4o) with structured JSON output.
 */
export async function reason(req: ReasoningRequest): Promise<ReasoningResult> {
  const validated = ReasoningRequestSchema.parse(req);
  const config = loadConfig();
  const openai = getOpenAI();

  const model = validated.model ?? 'gpt-4o';
  const systemPrompt = buildSystemPrompt(validated.mode, validated.maxSteps);
  const userPrompt = buildUserPrompt(validated);

  logger.info('[reasoning] start', { query: validated.query.slice(0, 100), mode: validated.mode, model });

  const start = Date.now();

  try {
    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: validated.temperature,
      response_format: { type: 'json_object' },
      max_tokens: 4096,
    });

    const raw = completion.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw);
    const result = ReasoningResultSchema.parse({
      ...parsed,
      query: validated.query, // enforce original query
    });

    const elapsed = Date.now() - start;
    logger.info('[reasoning] complete', {
      query: validated.query.slice(0, 100),
      steps: result.steps.length,
      confidence: result.confidence,
      elapsedMs: elapsed,
    });

    // If critique mode, run a second self-critique pass
    if (validated.mode === 'critique') {
      const critiqued = await selfCritique(result, model, validated.temperature);
      result.conclusion = critiqued.revisedConclusion ?? result.conclusion;
      result.caveats = [...result.caveats, ...critiqued.flaws];
      result.metadata = {
        ...result.metadata,
        critique: critiqued,
      };
    }

    return result;
  } catch (err) {
    logger.error('[reasoning] failed', { error: (err as Error).message, query: validated.query.slice(0, 100) });
    throw new Error(`Reasoning failed: ${(err as Error).message}`);
  }
}

/**
 * Self-critique a reasoning result. Identifies flaws, biases, and missing angles.
 */
export async function selfCritique(
  result: ReasoningResult,
  model = 'gpt-4o',
  temperature = 0.2
): Promise<CritiqueResult> {
  const openai = getOpenAI();

  const prompt = `You are a devil's advocate reviewing the following reasoning output.
Identify logical flaws, cognitive biases, missing evidence, and unstated assumptions.
Suggest concrete improvements and, if necessary, a revised conclusion.

Return JSON with:
- valid: boolean (is the reasoning sound?)
- flaws: array of strings
- improvements: array of strings
- revisedConclusion: string (optional, only if original is significantly flawed)

## Original Reasoning
${JSON.stringify({ steps: result.steps, conclusion: result.conclusion }, null, 2)}`;

  const completion = await openai.chat.completions.create({
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature,
    response_format: { type: 'json_object' },
    max_tokens: 2048,
  });

  const raw = completion.choices[0]?.message?.content ?? '{}';
  const parsed = JSON.parse(raw);
  return CritiqueResultSchema.parse(parsed);
}

/**
 * Multi-step reasoning chain that can call tools or sub-queries between steps.
 * Useful for complex business analysis (e.g., "Should we enter market X?").
 */
export async function multiStepReasoning(
  req: ReasoningRequest,
  stepHandlers?: Record<string, (step: ReasoningStep) => Promise<string>>
): Promise<ReasoningResult> {
  const result = await reason(req);

  // If step handlers are provided, enrich steps with external data
  if (stepHandlers) {
    for (const step of result.steps) {
      const handler = stepHandlers[step.title];
      if (handler) {
        try {
          const enrichment = await handler(step);
          step.reasoning += `\n\n[Enriched] ${enrichment}`;
          step.evidence.push(enrichment);
        } catch (err) {
          logger.warn('[reasoning] step handler failed', { step: step.title, error: (err as Error).message });
        }
      }
    }
  }

  return result;
}

/**
 * Generate a structured business memo from a reasoning result.
 */
export function toMemo(result: ReasoningResult): string {
  const lines: string[] = [
    `# Business Memo: ${result.query.slice(0, 60)}`,
    ``,
    `**Confidence:** ${(result.confidence * 100).toFixed(0)}%`,
    `**Generated:** ${new Date().toISOString()}`,
    ``,
    `## Reasoning`,
  ];

  for (const step of result.steps) {
    lines.push(`### Step ${step.stepNumber}: ${step.title}`);
    lines.push(step.reasoning);
    if (step.evidence.length) {
      lines.push(`**Evidence:** ${step.evidence.join('; ')}`);
    }
    lines.push(`**Confidence:** ${(step.confidence * 100).toFixed(0)}%`);
    lines.push('');
  }

  lines.push(`## Conclusion`);
  lines.push(result.conclusion);
  lines.push('');

  if (result.caveats.length) {
    lines.push(`## Caveats`);
    for (const c of result.caveats) lines.push(`- ${c}`);
    lines.push('');
  }

  if (result.actionItems.length) {
    lines.push(`## Action Items`);
    for (const a of result.actionItems) lines.push(`- [ ] ${a}`);
    lines.push('');
  }

  return lines.join('\n');
}
