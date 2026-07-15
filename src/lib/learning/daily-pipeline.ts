/**
 * src/lib/learning/daily-pipeline.ts
 * Nightly continuous learning pipeline.
 *
 * Runs daily to:
 * 1. Consolidate recent memories (deduplicate / summarize).
 * 2. Re-embed outdated vectors (older than 30 days).
 * 3. Extract new preferences from recent conversations.
 * 4. Generate a learning report and save it.
 *
 * Can be invoked via a cron job, Vercel cron, or manually.
 */

import { z } from 'zod';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { loadConfig } from '@/lib/config';
import { logger } from '@/lib/logger';
import {
  createEmbedding,
  storeMemory,
  getMemoryNamespace,
} from '@/lib/shadow/embed-memory';
import { extractPreferencesFromTurn } from '@/lib/shadow/extract-preferences';
import { getPineconeIndex } from '@/lib/vector/pinecone';
import type { Conversation, MemoryEntry } from '@/types';

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

export const DailyPipelineConfigSchema = z.object({
  userId: z.string().uuid().optional(),
  memoryConsolidationDays: z.number().int().min(1).max(90).default(1),
  vectorReembedThresholdDays: z.number().int().min(1).max(365).default(30),
  topKMemories: z.number().int().min(1).max(100).default(20),
});
export type DailyPipelineConfig = z.infer<typeof DailyPipelineConfigSchema>;

export const DailyPipelineResultSchema = z.object({
  userId: z.string().uuid(),
  memoriesConsolidated: z.number().int().nonnegative(),
  vectorsReEmbedded: z.number().int().nonnegative(),
  preferencesExtracted: z.record(z.unknown()),
  reportId: z.string().uuid(),
  summary: z.string(),
});
export type DailyPipelineResult = z.infer<typeof DailyPipelineResultSchema>;

// ---------------------------------------------------------------------------
// Supabase Client (internal, no Next.js dependency)
// ---------------------------------------------------------------------------

function getInternalSupabaseClient(): SupabaseClient {
  const config = loadConfig();
  return createClient(config.supabaseUrl, config.supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ---------------------------------------------------------------------------
// Main Pipeline
// ---------------------------------------------------------------------------

/**
 * Run the daily learning pipeline for a single user or all users.
 *
 * @param config - Pipeline configuration.
 * @returns The result of the pipeline run.
 */
export async function runDailyPipeline(
  config: z.input<typeof DailyPipelineConfigSchema> = {}
): Promise<DailyPipelineResult[]> {
  const opts = DailyPipelineConfigSchema.parse(config);
  const sb = getInternalSupabaseClient();
  const appConfig = loadConfig();

  // Resolve user(s) to process
  const userIds = opts.userId ? [opts.userId] : await fetchActiveUserIds(sb);

  const results: DailyPipelineResult[] = [];

  for (const userId of userIds) {
    try {
      logger.info('Daily pipeline started', { userId, opts });

      // 1. Consolidate recent memories
      const consolidatedCount = await consolidateMemories(
        userId,
        opts.memoryConsolidationDays,
        opts.topKMemories,
        appConfig
      );

      // 2. Re-embed outdated vectors
      const reembeddedCount = await reembedOutdatedVectors(
        userId,
        opts.vectorReembedThresholdDays,
        appConfig
      );

      // 3. Extract new preferences from recent conversations
      const preferences = await extractRecentPreferences(userId, sb, appConfig);

      // 4. Build summary
      const summary = buildLearningSummary(consolidatedCount, reembeddedCount, preferences);

      // 5. Save report
      const reportId = await saveLearningReport(userId, consolidatedCount, reembeddedCount, preferences, summary, sb);

      logger.info('Daily pipeline completed', {
        userId,
        reportId,
        consolidatedCount,
        reembeddedCount,
      });

      results.push({
        userId,
        memoriesConsolidated: consolidatedCount,
        vectorsReEmbedded: reembeddedCount,
        preferencesExtracted: preferences,
        reportId,
        summary,
      });
    } catch (err) {
      logger.error('Daily pipeline failed for user', {
        userId,
        error: (err as Error).message,
      });
      // Continue with next user; don't fail the entire batch
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// 1. Memory Consolidation
// ---------------------------------------------------------------------------

/**
 * Fetches recent memories, groups them by semantic similarity,
 * and stores summarized consolidated versions.
 */
async function consolidateMemories(
  userId: string,
  days: number,
  topK: number,
  appConfig: ReturnType<typeof loadConfig>
): Promise<number> {
  const sb = getInternalSupabaseClient();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // Fetch recent memories from Supabase
  const { data: memories, error } = await sb
    .from('memories')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(topK);

  if (error || !memories || memories.length === 0) {
    logger.info('No recent memories to consolidate', { userId, days });
    return 0;
  }

  const entries: MemoryEntry[] = memories.map((row) => ({
    id: String(row.id),
    userId: String(row.user_id),
    namespace: String(row.namespace),
    content: String(row.content),
    embedding: (row.embedding as number[]) || [],
    metadata: (row.metadata as Record<string, unknown>) || {},
    createdAt: String(row.created_at),
  }));

  // Simple similarity-based grouping (cosine similarity > 0.85)
  const groups = groupBySimilarity(entries, 0.85);
  let consolidated = 0;

  for (const group of groups) {
    if (group.length < 2) continue; // No consolidation needed for singletons

    const summary = group.map((m) => m.content).join('\n---\n');
    const shortened = await summarizeWithLLM(summary, appConfig);

    await storeMemory(userId, shortened, {
      source: 'consolidated_memory',
      originalMemoryIds: group.map((m) => m.id),
      consolidatedAt: new Date().toISOString(),
    }, appConfig);

    consolidated += 1;
  }

  logger.info('Memory consolidation complete', { userId, consolidated, groups: groups.length });
  return consolidated;
}

function groupBySimilarity(memories: MemoryEntry[], threshold: number): MemoryEntry[][] {
  const groups: MemoryEntry[][] = [];
  const used = new Set<string>();

  for (const memory of memories) {
    if (used.has(memory.id)) continue;

    const group: MemoryEntry[] = [memory];
    used.add(memory.id);

    for (const other of memories) {
      if (used.has(other.id)) continue;
      if (memory.embedding.length > 0 && other.embedding.length > 0) {
        const sim = cosineSimilarity(memory.embedding, other.embedding);
        if (sim >= threshold) {
          group.push(other);
          used.add(other.id);
        }
      }
    }

    groups.push(group);
  }

  return groups;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB) || 1);
}

// ---------------------------------------------------------------------------
// 2. Re-embed Outdated Vectors
// ---------------------------------------------------------------------------

/**
 * Finds vectors in Pinecone older than the threshold and re-embeds them
 * using the latest embedding model (text-embedding-3-small).
 */
async function reembedOutdatedVectors(
  userId: string,
  thresholdDays: number,
  appConfig: ReturnType<typeof loadConfig>
): Promise<number> {
  const sb = getInternalSupabaseClient();
  const since = new Date(Date.now() - thresholdDays * 24 * 60 * 60 * 1000).toISOString();

  // Fetch old memory metadata
  const { data: oldMemories, error } = await sb
    .from('memory_metadata')
    .select('*')
    .eq('user_id', userId)
    .lt('created_at', since)
    .limit(100);

  if (error || !oldMemories || oldMemories.length === 0) {
    logger.info('No outdated vectors to re-embed', { userId, thresholdDays });
    return 0;
  }

  const index = getPineconeIndex();
  const namespace = index.namespace(getMemoryNamespace(userId));
  let reembedded = 0;

  for (const row of oldMemories) {
    const content = String(row.content || '');
    const pineconeId = String(row.pinecone_id || '');
    if (!content || !pineconeId) continue;

    try {
      const newEmbedding = await createEmbedding(content, appConfig);

      await namespace.upsert([
        {
          id: pineconeId,
          values: newEmbedding,
          metadata: {
            ...(row.metadata as Record<string, unknown> || {}),
            content,
            userId,
            reembeddedAt: new Date().toISOString(),
          },
        },
      ]);

      reembedded += 1;
    } catch (err) {
      logger.warn('Failed to re-embed vector', { pineconeId, error: (err as Error).message });
    }
  }

  logger.info('Re-embedding complete', { userId, reembedded });
  return reembedded;
}

// ---------------------------------------------------------------------------
// 3. Preference Extraction
// ---------------------------------------------------------------------------

/**
 * Builds a pseudo-conversation from recent messages and extracts preferences.
 */
async function extractRecentPreferences(
  userId: string,
  sb: SupabaseClient,
  appConfig: ReturnType<typeof loadConfig>
): Promise<Record<string, unknown>> {
  const since = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();

  const { data: messages, error } = await sb
    .from('messages')
    .select('role, content, conversations!inner(user_id)')
    .eq('conversations.user_id', userId)
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .limit(50);

  if (error || !messages || messages.length === 0) {
    return {};
  }

  const conversation: Conversation = {
    id: 'daily-pipeline-dummy',
    userId,
    title: 'Daily Pipeline Extraction',
    messages: messages.map((m) => ({
      id: `msg-${Math.random().toString(36).slice(2)}`,
      role: m.role as 'user' | 'assistant' | 'system' | 'tool',
      content: String(m.content),
      createdAt: new Date().toISOString(),
    })),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  try {
    const extracted = await extractPreferencesFromTurn(conversation, appConfig);
    return extracted;
  } catch (err) {
    logger.warn('Preference extraction failed in daily pipeline', {
      userId,
      error: (err as Error).message,
    });
    return {};
  }
}

// ---------------------------------------------------------------------------
// 4. Report Generation
// ---------------------------------------------------------------------------

function buildLearningSummary(
  consolidated: number,
  reembedded: number,
  preferences: Record<string, unknown>
): string {
  const parts: string[] = [];

  if (consolidated > 0) {
    parts.push(`Consolidated ${consolidated} memory groups.`);
  }
  if (reembedded > 0) {
    parts.push(`Re-embedded ${reembedded} outdated vectors.`);
  }
  const prefKeys = Object.keys(preferences);
  if (prefKeys.length > 0) {
    parts.push(`Detected new preferences: ${prefKeys.join(', ')}.`);
  }

  if (parts.length === 0) {
    return 'No significant learning changes detected today.';
  }

  return parts.join(' ');
}

async function saveLearningReport(
  userId: string,
  consolidated: number,
  reembedded: number,
  preferences: Record<string, unknown>,
  summary: string,
  sb: SupabaseClient
): Promise<string> {
  const { data, error } = await sb
    .from('learning_reports')
    .insert({
      user_id: userId,
      report_date: new Date().toISOString().split('T')[0],
      memories_consolidated: consolidated,
      vectors_re_embedded: reembedded,
      preferences_extracted: preferences,
      summary,
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to save learning report: ${error?.message ?? 'unknown'}`);
  }

  return String(data.id);
}

// ---------------------------------------------------------------------------
// 5. Utility Helpers
// ---------------------------------------------------------------------------

async function fetchActiveUserIds(sb: SupabaseClient): Promise<string[]> {
  const { data, error } = await sb
    .from('user_profiles')
    .select('id')
    .limit(1000);

  if (error) {
    logger.error('Failed to fetch active users', { error });
    return [];
  }

  return (data || []).map((u) => String(u.id));
}

async function summarizeWithLLM(text: string, appConfig: ReturnType<typeof loadConfig>): Promise<string> {
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${appConfig.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'Summarize the following memories into a single concise paragraph. Preserve key facts and remove redundancy.',
          },
          { role: 'user', content: text.slice(0, 12000) }, // safety cap
        ],
        temperature: 0.3,
        max_tokens: 512,
      }),
    });

    if (!res.ok) {
      throw new Error(`OpenAI API error: ${res.status}`);
    }

    const json = await res.json();
    return String(json.choices?.[0]?.message?.content ?? text.slice(0, 500));
  } catch (err) {
    logger.warn('LLM summarization failed; returning truncated text', { error: (err as Error).message });
    return text.slice(0, 500);
  }
}
