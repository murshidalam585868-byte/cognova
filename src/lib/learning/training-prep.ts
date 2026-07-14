/**
 * src/lib/learning/training-prep.ts
 * Continuous Learning — Fine-Tuning Dataset Preparation
 *
 * Exports curated training examples from conversations + feedback into
 * format-compliant datasets for OpenAI, Anthropic, or generic fine-tuning.
 * Supports quality filtering, deduplication, tag-based selection, and
 * JSONL output generation.
 */

import { z } from 'zod';
import { getSupabaseClient } from '@/lib/db/supabase';
import { logger } from '@/lib/logger';
import type { TrainingExample, TrainingDataset, FeedbackEntry } from '@/types';

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

export const ExportConfigSchema = z.object({
  userId: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  format: z.enum(['openai', 'anthropic', 'generic']).default('openai'),
  qualityThreshold: z.number().min(0).max(1).default(0.7),
  tagFilter: z.array(z.string()).optional(),
  lookbackDays: z.number().int().min(1).max(365).default(90),
  requireFeedback: z.boolean().default(true),
  maxExamples: z.number().int().min(1).max(10000).default(1000),
  includeSystemPrompt: z.boolean().default(true),
  systemPrompt: z.string().max(4000).optional(),
});
export type ExportConfig = z.infer<typeof ExportConfigSchema>;

export const ExportResultSchema = z.object({
  datasetId: z.string().uuid(),
  exampleCount: z.number().int(),
  format: z.enum(['openai', 'anthropic', 'generic']),
  filePath: z.string(),
  fileSizeBytes: z.number().int(),
  averageQuality: z.number(),
  tagDistribution: z.record(z.number().int()),
  exportedAt: z.string().datetime(),
});
export type ExportResult = z.infer<typeof ExportResultSchema>;

// ---------------------------------------------------------------------------
// Core Operations
// ---------------------------------------------------------------------------

/**
 * Export a fine-tuning dataset from conversations + feedback.
 * Returns the path to the generated JSONL file and metadata.
 */
export async function exportTrainingDataset(config: ExportConfig): Promise<ExportResult> {
  const validated = ExportConfigSchema.parse(config);
  const sb = getSupabaseClient();

  // Build training examples from DB
  const examples = await buildTrainingExamples(validated);

  if (examples.length === 0) {
    throw new Error('No training examples matched the specified criteria');
  }

  // Format according to target spec
  const formatted = formatExamples(examples, validated);

  // Generate JSONL content
  const lines = formatted.map((item) => JSON.stringify(item)).join('\n');
  const encoder = new TextEncoder();
  const bytes = encoder.encode(lines);

  // In a serverless environment, we stream to a buffer / signed URL.
  // For this implementation, we return a data URL + persist metadata.
  const datasetId = crypto.randomUUID();
  const fileName = `training-dataset-${datasetId}.jsonl`;

  // Store blob in a simple buffer (production: stream to S3/R2/Supabase Storage)
  const buffer = Buffer.from(bytes);

  // Persist dataset record
  const { error: insertError } = await sb.from('training_datasets').insert({
    id: datasetId,
    user_id: validated.userId,
    name: validated.name,
    description: validated.description ?? null,
    example_ids: examples.map((e) => e.id),
    format: validated.format,
    quality_threshold: validated.qualityThreshold,
    tag_filter: validated.tagFilter ?? null,
    created_at: new Date().toISOString(),
    exported_at: new Date().toISOString(),
    file_size_bytes: buffer.length,
  });

  if (insertError) {
    logger.error('Failed to persist training dataset record', { error: insertError });
    throw new Error(`DB error: ${insertError.message}`);
  }

  // Store examples
  for (const example of examples) {
    await upsertTrainingExample(example);
  }

  // Compute tag distribution
  const tagDistribution: Record<string, number> = {};
  for (const ex of examples) {
    for (const tag of ex.tags) {
      tagDistribution[tag] = (tagDistribution[tag] ?? 0) + 1;
    }
  }

  const avgQuality =
    examples.reduce((sum, e) => sum + e.qualityScore, 0) / examples.length;

  logger.info('Training dataset exported', {
    datasetId,
    exampleCount: examples.length,
    format: validated.format,
    averageQuality: Math.round(avgQuality * 100) / 100,
  });

  return {
    datasetId,
    exampleCount: examples.length,
    format: validated.format,
    filePath: fileName,
    fileSizeBytes: buffer.length,
    averageQuality: Math.round(avgQuality * 100) / 100,
    tagDistribution,
    exportedAt: new Date().toISOString(),
  };
}

/**
 * Retrieve a previously exported training dataset by ID.
 */
export async function getTrainingDataset(datasetId: string): Promise<TrainingDataset | null> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('training_datasets')
    .select('*')
    .eq('id', datasetId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    logger.error('Failed to get training dataset', { error, datasetId });
    throw new Error(`DB error: ${error.message}`);
  }

  return mapTrainingDataset(data);
}

/**
 * List training datasets for a user.
 */
export async function listTrainingDatasets(
  userId: string,
  opts?: { limit?: number; offset?: number }
): Promise<TrainingDataset[]> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('training_datasets')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(opts?.limit ?? 20)
    .range(opts?.offset ?? 0, (opts?.offset ?? 0) + (opts?.limit ?? 20) - 1);

  if (error) {
    logger.error('Failed to list training datasets', { error, userId });
    throw new Error(`DB error: ${error.message}`);
  }

  return (data ?? []).map(mapTrainingDataset);
}

/**
 * Get individual training examples for a dataset.
 */
export async function getTrainingExamples(
  exampleIds: string[],
  opts?: { limit?: number }
): Promise<TrainingExample[]> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('training_examples')
    .select('*')
    .in('id', exampleIds)
    .limit(opts?.limit ?? 1000);

  if (error) {
    logger.error('Failed to get training examples', { error });
    throw new Error(`DB error: ${error.message}`);
  }

  return (data ?? []).map(mapTrainingExample);
}

// ---------------------------------------------------------------------------
// Filtering & Quality
// ---------------------------------------------------------------------------

/**
 * Build training examples from conversations with feedback.
 */
async function buildTrainingExamples(config: ExportConfig): Promise<TrainingExample[]> {
  const sb = getSupabaseClient();
  const since = new Date();
  since.setDate(since.getDate() - config.lookbackDays);

  // Fetch conversations with feedback in the lookback period
  let feedbackQuery = sb
    .from('feedback')
    .select('*, messages!inner(*)')
    .eq('user_id', config.userId)
    .gte('created_at', since.toISOString());

  if (config.tagFilter && config.tagFilter.length > 0) {
    // Supabase array overlap: tags && ARRAY[...]
    feedbackQuery = feedbackQuery.overlaps('tags', config.tagFilter);
  }

  const { data: feedbackRows, error } = await feedbackQuery.limit(config.maxExamples);

  if (error) {
    logger.error('Failed to fetch feedback for training examples', { error });
    throw new Error(`DB error: ${error.message}`);
  }

  const examples: TrainingExample[] = [];
  for (const row of feedbackRows ?? []) {
    const qualityScore = computeQualityScore(row as Record<string, unknown>);
    if (qualityScore < config.qualityThreshold) continue;

    const conversationId = String(row.conversation_id ?? '');
    if (!conversationId) continue;

    // Load conversation messages
    const { data: msgRows, error: msgErr } = await sb
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    if (msgErr || !msgRows) continue;

    const messages = msgRows.map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: String(m.content),
    }));

    // Filter to include only user->assistant pairs for fine-tuning
    const trainingMessages = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
    if (trainingMessages.length < 2) continue;

    examples.push({
      id: crypto.randomUUID(),
      userId: config.userId,
      conversationId,
      messages: trainingMessages,
      feedbackId: String(row.id),
      qualityScore,
      tags: (row.tags as string[]) ?? [],
      metadata: {
        feedback: row.feedback,
        rating: row.rating,
        messageCount: trainingMessages.length,
      },
      createdAt: String(row.created_at),
    });
  }

  // Deduplicate by conversation ID (keep highest quality)
  const byConversation = new Map<string, TrainingExample[]>();
  for (const ex of examples) {
    const list = byConversation.get(ex.conversationId) ?? [];
    list.push(ex);
    byConversation.set(ex.conversationId, list);
  }

  const deduplicated: TrainingExample[] = [];
  for (const list of byConversation.values()) {
    list.sort((a, b) => b.qualityScore - a.qualityScore);
    deduplicated.push(list[0]);
  }

  return deduplicated.slice(0, config.maxExamples);
}

/**
 * Compute a quality score for a training example based on feedback.
 */
export function computeQualityScore(feedbackRow: Record<string, unknown>): number {
  const feedback = String(feedbackRow.feedback ?? 'neutral');
  const rating = Number(feedbackRow.rating ?? 3);

  // Base score from feedback type
  let score = 0.5;
  if (feedback === 'positive') score = 0.85;
  else if (feedback === 'negative') score = 0.2;
  else if (feedback === 'neutral') score = 0.5;

  // Adjust by rating (1-5)
  const ratingNormalized = (rating - 1) / 4;
  score = score * 0.6 + ratingNormalized * 0.4;

  return Math.min(1, Math.max(0, score));
}

/**
 * Format training examples for the target provider.
 */
function formatExamples(
  examples: TrainingExample[],
  config: ExportConfig
): Array<Record<string, unknown>> {
  switch (config.format) {
    case 'openai':
      return examples.map((ex) => formatOpenAIExample(ex, config));
    case 'anthropic':
      return examples.map((ex) => formatAnthropicExample(ex, config));
    case 'generic':
    default:
      return examples.map((ex) => formatGenericExample(ex, config));
  }
}

function formatOpenAIExample(
  example: TrainingExample,
  config: ExportConfig
): Record<string, unknown> {
  const messages: Array<{ role: string; content: string }> = [];

  if (config.includeSystemPrompt && config.systemPrompt) {
    messages.push({ role: 'system', content: config.systemPrompt });
  } else if (config.includeSystemPrompt) {
    messages.push({
      role: 'system',
      content: 'You are a helpful AI CEO Office assistant.',
    });
  }

  for (const msg of example.messages) {
    messages.push({ role: msg.role, content: msg.content });
  }

  return {
    messages,
    metadata: {
      conversation_id: example.conversationId,
      quality_score: example.qualityScore,
      tags: example.tags,
    },
  };
}

function formatAnthropicExample(
  example: TrainingExample,
  config: ExportConfig
): Record<string, unknown> {
  const systemPrompt = config.systemPrompt ?? 'You are a helpful AI CEO Office assistant.';
  const conversation: Array<{ role: string; content: string }> = [];

  for (const msg of example.messages) {
    conversation.push({ role: msg.role, content: msg.content });
  }

  return {
    system: systemPrompt,
    messages: conversation,
    metadata: {
      conversation_id: example.conversationId,
      quality_score: example.qualityScore,
      tags: example.tags,
    },
  };
}

function formatGenericExample(
  example: TrainingExample,
  config: ExportConfig
): Record<string, unknown> {
  const prompt = example.messages
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join('\n\n');
  const completion = example.messages
    .filter((m) => m.role === 'assistant')
    .map((m) => m.content)
    .join('\n\n');

  return {
    prompt: prompt || 'N/A',
    completion: completion || 'N/A',
    system: config.systemPrompt ?? null,
    metadata: {
      conversation_id: example.conversationId,
      quality_score: example.qualityScore,
      tags: example.tags,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function upsertTrainingExample(example: TrainingExample): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.from('training_examples').upsert({
    id: example.id,
    user_id: example.userId,
    conversation_id: example.conversationId,
    messages: example.messages as unknown[],
    feedback_id: example.feedbackId ?? null,
    quality_score: example.qualityScore,
    tags: example.tags,
    metadata: example.metadata,
    created_at: example.createdAt,
  });

  if (error) {
    logger.warn('Failed to upsert training example', { error, exampleId: example.id });
  }
}

function mapTrainingDataset(row: Record<string, unknown>): TrainingDataset {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    name: String(row.name ?? ''),
    description: row.description ? String(row.description) : undefined,
    exampleIds: (row.example_ids as string[]) ?? [],
    format: (row.format as TrainingDataset['format']) ?? 'openai',
    qualityThreshold: Number(row.quality_threshold ?? 0.7),
    tagFilter: (row.tag_filter as string[]) ?? undefined,
    createdAt: String(row.created_at),
    exportedAt: row.exported_at ? String(row.exported_at) : undefined,
    fileUrl: row.file_url ? String(row.file_url) : undefined,
  };
}

function mapTrainingExample(row: Record<string, unknown>): TrainingExample {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    conversationId: String(row.conversation_id),
    messages: (row.messages as Array<{ role: 'user' | 'assistant' | 'system'; content: string }>) ?? [],
    feedbackId: row.feedback_id ? String(row.feedback_id) : undefined,
    qualityScore: Number(row.quality_score ?? 0.5),
    tags: (row.tags as string[]) ?? [],
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: String(row.created_at),
  };
}
