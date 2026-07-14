/**
 * src/lib/learning/feedback-loop.ts
 * Continuous Learning — Feedback Loop
 *
 * Collects, stores, and aggregates user feedback on AI responses.
 * Provides quality scores, trend analysis, and per-conversation feedback stats.
 * All operations are Zod-validated, typed, and async.
 */

import { z } from 'zod';
import { getSupabaseClient } from '@/lib/db/supabase';
import { logger } from '@/lib/logger';
import type { FeedbackEntry, FeedbackStats, Message } from '@/types';

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

export const FeedbackSubmitSchema = z.object({
  userId: z.string().uuid(),
  messageId: z.string().uuid(),
  conversationId: z.string().uuid(),
  feedback: z.enum(['positive', 'negative', 'neutral']),
  rating: z.number().int().min(1).max(5).optional(),
  comment: z.string().max(2000).optional(),
  tags: z.array(z.string().min(1).max(50)).default([]),
  metadata: z.record(z.unknown()).default({}),
});
export type FeedbackSubmitInput = z.infer<typeof FeedbackSubmitSchema>;

export const FeedbackQuerySchema = z.object({
  userId: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
  messageId: z.string().uuid().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(500).default(50),
  offset: z.number().int().min(0).default(0),
});
export type FeedbackQueryInput = z.infer<typeof FeedbackQuerySchema>;

export const FeedbackStatsQuerySchema = z.object({
  userId: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
  days: z.number().int().min(1).max(365).default(30),
});
export type FeedbackStatsQueryInput = z.infer<typeof FeedbackStatsQuerySchema>;

// ---------------------------------------------------------------------------
// Core Operations
// ---------------------------------------------------------------------------

/**
 * Submit user feedback for a specific assistant message.
 */
export async function submitFeedback(input: FeedbackSubmitInput): Promise<FeedbackEntry> {
  const validated = FeedbackSubmitSchema.parse(input);
  const sb = getSupabaseClient();

  const { data, error } = await sb
    .from('feedback')
    .insert({
      user_id: validated.userId,
      message_id: validated.messageId,
      conversation_id: validated.conversationId,
      feedback: validated.feedback,
      rating: validated.rating ?? null,
      comment: validated.comment ?? null,
      tags: validated.tags,
      metadata: validated.metadata,
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to submit feedback', { error, messageId: validated.messageId });
    throw new Error(`DB error: ${error.message}`);
  }

  const entry = mapFeedbackEntry(data);
  logger.info('Feedback submitted', { feedbackId: entry.id, messageId: entry.messageId, feedback: entry.feedback });
  return entry;
}

/**
 * Retrieve feedback entries for a user, optionally filtered by conversation or message.
 */
export async function getFeedback(query: FeedbackQueryInput): Promise<FeedbackEntry[]> {
  const validated = FeedbackQuerySchema.parse(query);
  const sb = getSupabaseClient();

  let dbQuery = sb
    .from('feedback')
    .select('*')
    .eq('user_id', validated.userId)
    .order('created_at', { ascending: false })
    .range(validated.offset, validated.offset + validated.limit - 1);

  if (validated.conversationId) {
    dbQuery = dbQuery.eq('conversation_id', validated.conversationId);
  }
  if (validated.messageId) {
    dbQuery = dbQuery.eq('message_id', validated.messageId);
  }
  if (validated.startDate) {
    dbQuery = dbQuery.gte('created_at', validated.startDate);
  }
  if (validated.endDate) {
    dbQuery = dbQuery.lte('created_at', validated.endDate);
  }

  const { data, error } = await dbQuery;

  if (error) {
    logger.error('Failed to query feedback', { error, userId: validated.userId });
    throw new Error(`DB error: ${error.message}`);
  }

  return (data ?? []).map(mapFeedbackEntry);
}

/**
 * Get feedback for a specific message.
 */
export async function getFeedbackForMessage(messageId: string): Promise<FeedbackEntry[]> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('feedback')
    .select('*')
    .eq('message_id', messageId)
    .order('created_at', { ascending: false });

  if (error) {
    logger.error('Failed to get feedback for message', { error, messageId });
    throw new Error(`DB error: ${error.message}`);
  }

  return (data ?? []).map(mapFeedbackEntry);
}

/**
 * Compute aggregate feedback statistics for a user or conversation.
 */
export async function getFeedbackStats(query: FeedbackStatsQueryInput): Promise<FeedbackStats> {
  const validated = FeedbackStatsQuerySchema.parse(query);
  const sb = getSupabaseClient();

  const since = new Date();
  since.setDate(since.getDate() - validated.days);
  const sinceIso = since.toISOString();

  // Build base query
  let dbQuery = sb
    .from('feedback')
    .select('*')
    .eq('user_id', validated.userId)
    .gte('created_at', sinceIso);

  if (validated.conversationId) {
    dbQuery = dbQuery.eq('conversation_id', validated.conversationId);
  }

  const { data, error } = await dbQuery;

  if (error) {
    logger.error('Failed to compute feedback stats', { error, userId: validated.userId });
    throw new Error(`DB error: ${error.message}`);
  }

  const entries = (data ?? []).map(mapFeedbackEntry);
  return computeFeedbackStats(entries, validated.days);
}

/**
 * Aggregate feedback for a full conversation into a single quality score.
 */
export async function aggregateFeedbackForConversation(
  conversationId: string
): Promise<{ score: number; breakdown: Record<string, number> }> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('feedback')
    .select('*')
    .eq('conversation_id', conversationId);

  if (error) {
    logger.error('Failed to aggregate feedback', { error, conversationId });
    throw new Error(`DB error: ${error.message}`);
  }

  const entries = (data ?? []).map(mapFeedbackEntry);
  const positive = entries.filter((e) => e.feedback === 'positive').length;
  const negative = entries.filter((e) => e.feedback === 'negative').length;
  const neutral = entries.filter((e) => e.feedback === 'neutral').length;
  const total = entries.length;

  const avgRating =
    total > 0
      ? entries.reduce((sum, e) => sum + (e.rating ?? 3), 0) / total
      : 0;

  // Weighted score: positive=1, neutral=0.5, negative=0, rating normalized to 0-1
  const feedbackScore =
    total > 0 ? (positive * 1 + neutral * 0.5 + negative * 0) / total : 0.5;
  const ratingScore = avgRating / 5;
  const compositeScore = Math.round(((feedbackScore * 0.6 + ratingScore * 0.4) * 100) * 100) / 100;

  return {
    score: compositeScore,
    breakdown: {
      positive,
      negative,
      neutral,
      total,
      averageRating: Math.round(avgRating * 100) / 100,
      compositeScore,
    },
  };
}

/**
 * Update a feedback entry (e.g., user edits their comment).
 */
export async function updateFeedback(
  feedbackId: string,
  updates: Partial<Pick<FeedbackSubmitInput, 'feedback' | 'rating' | 'comment' | 'tags'>>
): Promise<FeedbackEntry> {
  const sb = getSupabaseClient();

  const patch: Record<string, unknown> = {};
  if (updates.feedback) patch.feedback = updates.feedback;
  if (updates.rating !== undefined) patch.rating = updates.rating;
  if (updates.comment !== undefined) patch.comment = updates.comment;
  if (updates.tags) patch.tags = updates.tags;

  const { data, error } = await sb
    .from('feedback')
    .update(patch)
    .eq('id', feedbackId)
    .select()
    .single();

  if (error) {
    logger.error('Failed to update feedback', { error, feedbackId });
    throw new Error(`DB error: ${error.message}`);
  }

  return mapFeedbackEntry(data);
}

/**
 * Delete a feedback entry.
 */
export async function deleteFeedback(feedbackId: string): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.from('feedback').delete().eq('id', feedbackId);

  if (error) {
    logger.error('Failed to delete feedback', { error, feedbackId });
    throw new Error(`DB error: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeFeedbackStats(entries: FeedbackEntry[], days: number): FeedbackStats {
  const total = entries.length;
  const positive = entries.filter((e) => e.feedback === 'positive').length;
  const negative = entries.filter((e) => e.feedback === 'negative').length;
  const neutral = entries.filter((e) => e.feedback === 'neutral').length;

  const avgRating =
    total > 0
      ? entries.reduce((sum, e) => sum + (e.rating ?? 3), 0) / total
      : 0;

  // Tag frequency
  const tagCounts = new Map<string, number>();
  for (const entry of entries) {
    for (const tag of entry.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }
  const topTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag]) => tag);

  // Trend: compare first half vs second half of period
  let trendDirection: FeedbackStats['trendDirection'] = 'insufficient_data';
  if (total >= 6) {
    const mid = Math.floor(total / 2);
    const firstHalf = entries.slice(0, mid);
    const secondHalf = entries.slice(mid);
    const scoreFirst =
      firstHalf.reduce((s, e) => s + (e.feedback === 'positive' ? 1 : e.feedback === 'neutral' ? 0.5 : 0), 0) /
      firstHalf.length;
    const scoreSecond =
      secondHalf.reduce((s, e) => s + (e.feedback === 'positive' ? 1 : e.feedback === 'neutral' ? 0.5 : 0), 0) /
      secondHalf.length;
    const delta = scoreSecond - scoreFirst;
    if (delta > 0.1) trendDirection = 'improving';
    else if (delta < -0.1) trendDirection = 'declining';
    else trendDirection = 'stable';
  }

  const now = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);

  return {
    totalFeedback: total,
    positiveCount: positive,
    negativeCount: negative,
    neutralCount: neutral,
    averageRating: Math.round(avgRating * 100) / 100,
    positiveRate: total > 0 ? Math.round((positive / total) * 10000) / 10000 : 0,
    topTags,
    trendDirection,
    periodStart: start.toISOString(),
    periodEnd: now.toISOString(),
  };
}

function mapFeedbackEntry(row: Record<string, unknown>): FeedbackEntry {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    messageId: String(row.message_id),
    conversationId: String(row.conversation_id),
    feedback: row.feedback as FeedbackEntry['feedback'],
    rating: row.rating ? Number(row.rating) : undefined,
    comment: row.comment ? String(row.comment) : undefined,
    tags: (row.tags as string[]) ?? [],
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: String(row.created_at),
  };
}
