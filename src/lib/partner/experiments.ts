/**
 * Shadow Brain — Phase 4: AI Business Partner
 * Experiment Tracker
 *
 * Tracks A/B tests, business experiments, and growth initiatives.
 * Integrates with Supabase for persistence and Google Sheets for reporting.
 * Supports hypothesis-driven experiment design with structured metrics.
 */

import { z } from 'zod';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { loadConfig } from '@/lib/config';
import { logger } from '@/lib/logger';
import type { Experiment } from '@/types';

// ── Zod Schemas ────────────────────────────────────────────────────────────

export const ExperimentStatusSchema = z.enum(['draft', 'running', 'completed', 'cancelled', 'archived']);
export type ExperimentStatus = z.infer<typeof ExperimentStatusSchema>;

export const ExperimentCreateSchema = z.object({
  name: z.string().min(1).max(200),
  hypothesis: z.string().min(10),
  description: z.string().optional(),
  owner: z.string().email().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  controlGroup: z.object({ name: z.string(), description: z.string().optional() }).optional(),
  treatmentGroup: z.object({ name: z.string(), description: z.string().optional() }).optional(),
  primaryMetric: z.string().min(1),
  secondaryMetrics: z.array(z.string()).optional().default([]),
  successCriteria: z.string().optional(), // e.g., "+10% conversion rate with p<0.05"
  targetSampleSize: z.number().int().positive().optional(),
  tags: z.array(z.string()).optional().default([]),
});
export type ExperimentCreate = z.infer<typeof ExperimentCreateSchema>;

export const ExperimentUpdateSchema = z.object({
  id: z.string().uuid(),
  status: ExperimentStatusSchema.optional(),
  endDate: z.string().datetime().optional(),
  metrics: z.record(z.number()).optional(),
  notes: z.string().optional(),
  conclusion: z.string().optional(),
  recommendation: z.string().optional(),
});
export type ExperimentUpdate = z.infer<typeof ExperimentUpdateSchema>;

export const ExperimentResultSchema = z.object({
  experimentId: z.string().uuid(),
  metricName: z.string(),
  controlValue: z.number(),
  treatmentValue: z.number(),
  uplift: z.number(), // percentage or absolute
  pValue: z.number().optional(),
  confidenceInterval: z.tuple([z.number(), z.number()]).optional(),
  sampleSize: z.number().int().optional(),
  recordedAt: z.string().datetime(),
});
export type ExperimentResult = z.infer<typeof ExperimentResultSchema>;

export const ExperimentListFilterSchema = z.object({
  status: ExperimentStatusSchema.optional(),
  owner: z.string().optional(),
  tags: z.array(z.string()).optional(),
  search: z.string().optional(),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(100).default(20),
});
export type ExperimentListFilter = z.infer<typeof ExperimentListFilterSchema>;

// ── Supabase Client ───────────────────────────────────────────────────────

let _supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (_supabase) return _supabase;
  const config = loadConfig();
  _supabase = createClient(config.supabaseUrl, config.supabaseServiceKey);
  return _supabase;
}

export function resetExperimentSupabase(): void {
  _supabase = null;
}

// ── CRUD Operations ────────────────────────────────────────────────────────

/**
 * Create a new experiment record.
 */
export async function createExperiment(input: ExperimentCreate): Promise<Experiment> {
  const validated = ExperimentCreateSchema.parse(input);
  const supabase = getSupabase();

  const now = new Date().toISOString();
  const row = {
    name: validated.name,
    hypothesis: validated.hypothesis,
    description: validated.description ?? null,
    owner: validated.owner ?? null,
    status: 'draft' as const,
    start_date: validated.startDate ?? null,
    end_date: validated.endDate ?? null,
    control_group: validated.controlGroup ?? null,
    treatment_group: validated.treatmentGroup ?? null,
    primary_metric: validated.primaryMetric,
    secondary_metrics: validated.secondaryMetrics,
    success_criteria: validated.successCriteria ?? null,
    target_sample_size: validated.targetSampleSize ?? null,
    tags: validated.tags,
    metrics: {},
    created_at: now,
    updated_at: now,
  };

  const { data, error } = await supabase
    .from('experiments')
    .insert(row)
    .select()
    .single();

  if (error) {
    logger.error('[experiments] createExperiment failed', { error: error.message });
    throw new Error(`Failed to create experiment: ${error.message}`);
  }

  logger.info('[experiments] created', { id: data.id, name: validated.name });
  return mapRowToExperiment(data);
}

/**
 * Update an experiment's status, metrics, notes, or conclusion.
 */
export async function updateExperiment(input: ExperimentUpdate): Promise<Experiment> {
  const validated = ExperimentUpdateSchema.parse(input);
  const supabase = getSupabase();

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (validated.status !== undefined) updates.status = validated.status;
  if (validated.endDate !== undefined) updates.end_date = validated.endDate;
  if (validated.metrics !== undefined) updates.metrics = validated.metrics;
  if (validated.notes !== undefined) updates.notes = validated.notes;
  if (validated.conclusion !== undefined) updates.conclusion = validated.conclusion;
  if (validated.recommendation !== undefined) updates.recommendation = validated.recommendation;

  const { data, error } = await supabase
    .from('experiments')
    .update(updates)
    .eq('id', validated.id)
    .select()
    .single();

  if (error) {
    logger.error('[experiments] updateExperiment failed', { error: error.message, id: validated.id });
    throw new Error(`Failed to update experiment: ${error.message}`);
  }

  logger.info('[experiments] updated', { id: validated.id, status: validated.status });
  return mapRowToExperiment(data);
}

/**
 * Get a single experiment by ID.
 */
export async function getExperiment(id: string): Promise<Experiment | null> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // not found
    logger.error('[experiments] getExperiment failed', { error: error.message, id });
    throw new Error(`Failed to get experiment: ${error.message}`);
  }

  return mapRowToExperiment(data);
}

/**
 * List experiments with pagination and filtering.
 */
export async function listExperiments(filter: ExperimentListFilter): Promise<{
  experiments: Experiment[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const validated = ExperimentListFilterSchema.parse(filter);
  const supabase = getSupabase();

  let query = supabase.from('experiments').select('*', { count: 'exact' });

  if (validated.status) {
    query = query.eq('status', validated.status);
  }
  if (validated.owner) {
    query = query.eq('owner', validated.owner);
  }
  if (validated.tags && validated.tags.length > 0) {
    // Supabase array overlap: contains any of the tags
    query = query.overlaps('tags', validated.tags);
  }
  if (validated.search) {
    query = query.or(`name.ilike.%${validated.search}%,hypothesis.ilike.%${validated.search}%`);
  }
  if (validated.fromDate) {
    query = query.gte('created_at', validated.fromDate);
  }
  if (validated.toDate) {
    query = query.lte('created_at', validated.toDate);
  }

  const from = (validated.page - 1) * validated.pageSize;
  const to = from + validated.pageSize - 1;

  const { data, error, count } = await query.range(from, to).order('created_at', { ascending: false });

  if (error) {
    logger.error('[experiments] listExperiments failed', { error: error.message });
    throw new Error(`Failed to list experiments: ${error.message}`);
  }

  return {
    experiments: (data ?? []).map(mapRowToExperiment),
    total: count ?? 0,
    page: validated.page,
    pageSize: validated.pageSize,
  };
}

/**
 * Delete an experiment (soft-delete by archiving).
 */
export async function archiveExperiment(id: string): Promise<Experiment> {
  return updateExperiment({ id, status: 'archived' });
}

// ── Experiment Results ───────────────────────────────────────────────────

/**
 * Record a metric result for an experiment.
 */
export async function recordResult(result: ExperimentResult): Promise<void> {
  const validated = ExperimentResultSchema.parse(result);
  const supabase = getSupabase();

  const { error } = await supabase.from('experiment_results').insert({
    experiment_id: validated.experimentId,
    metric_name: validated.metricName,
    control_value: validated.controlValue,
    treatment_value: validated.treatmentValue,
    uplift: validated.uplift,
    p_value: validated.pValue ?? null,
    confidence_interval: validated.confidenceInterval ?? null,
    sample_size: validated.sampleSize ?? null,
    recorded_at: validated.recordedAt,
  });

  if (error) {
    logger.error('[experiments] recordResult failed', { error: error.message, experimentId: validated.experimentId });
    throw new Error(`Failed to record result: ${error.message}`);
  }

  logger.info('[experiments] result recorded', { experimentId: validated.experimentId, metric: validated.metricName });
}

/**
 * Get all results for an experiment.
 */
export async function getResults(experimentId: string): Promise<ExperimentResult[]> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('experiment_results')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('recorded_at', { ascending: true });

  if (error) {
    logger.error('[experiments] getResults failed', { error: error.message, experimentId });
    throw new Error(`Failed to get results: ${error.message}`);
  }

  return (data ?? []).map((row: any) =>
    ExperimentResultSchema.parse({
      experimentId: row.experiment_id,
      metricName: row.metric_name,
      controlValue: row.control_value,
      treatmentValue: row.treatment_value,
      uplift: row.uplift,
      pValue: row.p_value,
      confidenceInterval: row.confidence_interval,
      sampleSize: row.sample_size,
      recordedAt: row.recorded_at,
    })
  );
}

// ── Statistical Helpers ────────────────────────────────────────────────────

/**
 * Compute a two-proportion z-test for conversion experiments.
 */
export function twoProportionZTest(
  controlSuccesses: number,
  controlTotal: number,
  treatmentSuccesses: number,
  treatmentTotal: number
): { zScore: number; pValue: number; uplift: number } {
  const p1 = controlSuccesses / controlTotal;
  const p2 = treatmentSuccesses / treatmentTotal;
  const p = (controlSuccesses + treatmentSuccesses) / (controlTotal + treatmentTotal);
  const se = Math.sqrt(p * (1 - p) * (1 / controlTotal + 1 / treatmentTotal));
  const zScore = (p2 - p1) / se;
  const pValue = 2 * (1 - normalCdf(Math.abs(zScore)));
  const uplift = (p2 - p1) / p1;

  return { zScore, pValue, uplift };
}

/**
 * Approximate normal CDF using error function.
 */
function normalCdf(x: number): number {
  // Abramowitz & Stegun approximation
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + p * absX);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);

  return 0.5 * (1 + sign * y);
}

/**
 * Evaluate whether an experiment's results meet the success criteria.
 * Returns a structured recommendation.
 */
export function evaluateExperiment(experiment: Experiment, results: ExperimentResult[]): {
  success: boolean;
  primaryResult?: ExperimentResult;
  recommendation: string;
  confidence: number;
} {
  if (results.length === 0) {
    return { success: false, recommendation: 'No results recorded yet. Continue running the experiment.', confidence: 0 };
  }

  const primary = results.find((r) => r.metricName === experiment.primaryMetric) ?? results[0];

  // Naive success criteria parsing: e.g., "+10%" or "p<0.05"
  const success =
    primary.uplift > 0 &&
    (primary.pValue === undefined || primary.pValue < 0.05);

  const recommendation = success
    ? `Experiment succeeded. ${experiment.primaryMetric} improved by ${(primary.uplift * 100).toFixed(1)}%. Consider rolling out to 100%.`
    : `Experiment did not reach significance. ${experiment.primaryMetric} changed by ${(primary.uplift * 100).toFixed(1)}% (p=${primary.pValue?.toFixed(3) ?? 'N/A'}). Recommend iterating or abandoning.`;

  return {
    success,
    primaryResult: primary,
    recommendation,
    confidence: primary.pValue !== undefined ? 1 - primary.pValue : 0.7,
  };
}

// ── Row Mapper ─────────────────────────────────────────────────────────────

function mapRowToExperiment(row: any): Experiment {
  return {
    id: row.id,
    name: row.name,
    hypothesis: row.hypothesis,
    status: row.status,
    metrics: row.metrics ?? {},
    startDate: row.start_date,
    endDate: row.end_date ?? undefined,
  };
}
