import { z } from 'zod';
import { AppConfig } from '../config';
import { Conversation, UserPreferences } from '../../types';
import { extractPreferencesFromTurn } from './extract-preferences';

/**
 * Shadow Brain — Evaluation Framework
 * Phase 2: Digital Shadow Self
 *
 * Provides a synthetic evaluation set and runner to measure the quality
 * of preference extraction. Computes precision, recall, and F1 against
 * ground-truth labels.
 */

// ------------------------------------------------------------------
// Schemas
// ------------------------------------------------------------------
export const EvalMetricsSchema = z.object({
  precision: z.number().min(0).max(1),
  recall: z.number().min(0).max(1),
  f1: z.number().min(0).max(1),
  casesRun: z.number().int().nonnegative(),
  failures: z.array(z.string()),
});
export type EvalMetrics = z.infer<typeof EvalMetricsSchema>;

interface EvalCase {
  id: string;
  conversation: Conversation;
  expected: Partial<UserPreferences>;
}

// ------------------------------------------------------------------
// Synthetic Evaluation Dataset
// ------------------------------------------------------------------
const EVAL_SET: EvalCase[] = [
  {
    id: 'eval-tone-technical',
    conversation: {
      id: 'c1',
      userId: 'u1',
      title: 'Technical Tone Eval',
      messages: [
        {
          id: 'm1',
          role: 'user',
          content:
            'I am a software engineer. I want short, technical answers without fluff.',
          createdAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'm2',
          role: 'assistant',
          content: 'Understood. I will provide concise, technical responses.',
          createdAt: '2026-01-01T00:00:01Z',
        },
      ],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:01Z',
    },
    expected: {
      tone: 'technical',
      verbosity: 'minimal',
      responseStyle: 'directive',
      industries: ['software engineering'],
    },
  },
  {
    id: 'eval-casual-collaborative',
    conversation: {
      id: 'c2',
      userId: 'u1',
      title: 'Casual Collaborative Eval',
      messages: [
        {
          id: 'm1',
          role: 'user',
          content:
            'Hey! Can we chat like friends? I love brainstorming about marketing and startups.',
          createdAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'm2',
          role: 'assistant',
          content: 'Absolutely! I am here to brainstorm with you.',
          createdAt: '2026-01-01T00:00:01Z',
        },
      ],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:01Z',
    },
    expected: {
      tone: 'casual',
      verbosity: 'standard',
      responseStyle: 'collaborative',
      topicsOfInterest: ['marketing', 'startups'],
    },
  },
  {
    id: 'eval-detailed-socratic',
    conversation: {
      id: 'c3',
      userId: 'u1',
      title: 'Detailed Socratic Eval',
      messages: [
        {
          id: 'm1',
          role: 'user',
          content:
            'I prefer detailed explanations. Please ask me questions to guide me instead of just giving answers. I am in Tokyo.',
          createdAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'm2',
          role: 'assistant',
          content:
            'Sure, I will adopt a Socratic approach with detailed explanations.',
          createdAt: '2026-01-01T00:00:01Z',
        },
      ],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:01Z',
    },
    expected: {
      tone: 'detailed',
      verbosity: 'verbose',
      responseStyle: 'socratic',
      timezone: 'Asia/Tokyo',
    },
  },
];

// ------------------------------------------------------------------
// Scoring Logic
// ------------------------------------------------------------------
/**
 * Scores a single evaluation case.
 *
 * For arrays: intersection = true positives, extras = false positives, misses = false negatives.
 * For scalars: exact match = tp, mismatch or missing = fn/fp.
 */
function scorePreferences(
  expected: Partial<UserPreferences>,
  actual: Partial<UserPreferences>
): { precision: number; recall: number } {
  const keys = Object.keys(expected) as (keyof UserPreferences)[];
  let tp = 0;
  let fp = 0;
  let fn = 0;

  for (const key of keys) {
    const expValue = expected[key];
    const actValue = actual[key];

    if (Array.isArray(expValue)) {
      const actArray = Array.isArray(actValue) ? actValue : [];
      const intersection = (expValue as string[]).filter((v) =>
        actArray.includes(v)
      );
      tp += intersection.length;
      fp += actArray.length - intersection.length;
      fn += (expValue as string[]).length - intersection.length;
    } else {
      if (actValue === undefined) {
        fn += 1;
      } else if (actValue === expValue) {
        tp += 1;
      } else {
        fp += 1;
        fn += 1;
      }
    }
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  return { precision, recall };
}

// ------------------------------------------------------------------
// Evaluation Runner
// ------------------------------------------------------------------
/**
 * Runs the extraction evaluation suite against the synthetic dataset.
 *
 * @param config - AppConfig with OpenAI API key.
 * @returns Evaluation result with aggregated precision, recall, F1, and any failures.
 */
export async function runExtractionEvaluation(
  config: AppConfig
): Promise<{ passed: boolean; metrics: EvalMetrics }> {
  const failures: string[] = [];
  let totalPrecision = 0;
  let totalRecall = 0;

  for (const evalCase of EVAL_SET) {
    try {
      const extracted = await extractPreferencesFromTurn(evalCase.conversation, config);
      const { precision, recall } = scorePreferences(evalCase.expected, extracted);
      totalPrecision += precision;
      totalRecall += recall;

      if (precision < 1 || recall < 1) {
        failures.push(
          `${evalCase.id}: precision=${precision.toFixed(2)}, recall=${recall.toFixed(2)}`
        );
      }
    } catch (err) {
      failures.push(
        `${evalCase.id}: error=${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  const n = EVAL_SET.length;
  const avgPrecision = n > 0 ? totalPrecision / n : 0;
  const avgRecall = n > 0 ? totalRecall / n : 0;
  const f1 =
    avgPrecision + avgRecall > 0
      ? (2 * avgPrecision * avgRecall) / (avgPrecision + avgRecall)
      : 0;

  const passed = failures.length === 0;

  const metrics = EvalMetricsSchema.parse({
    precision: avgPrecision,
    recall: avgRecall,
    f1,
    casesRun: n,
    failures,
  });

  return { passed, metrics };
}
