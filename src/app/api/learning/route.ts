/**
 * src/app/api/learning/route.ts
 * Learning Engine API
 *
 * HTTP interface for the Continuous Learning & Self-Improvement Engine.
 * Supports feedback submission, preference snapshots, drift detection,
 * memory consolidation, skill discovery, and training dataset export.
 *
 * Endpoints (POST /api/learning?op=<operation>):
 *   - feedback        → Submit thumbs up/down
 *   - snapshot        → Capture preference snapshot
 *   - consolidate     → Run memory consolidation batch
 *   - discover        → Run skill discovery
 *   - export          → Export fine-tuning dataset
 *
 * GET endpoints (?op=<operation>):
 *   - feedback/stats  → Get feedback statistics
 *   - drift           → Get latest drift report
 *   - memories        → Retrieve consolidated memories
 *   - skills          → List discovered skills
 *   - datasets        → List training datasets
 *   - insights        → Get composite learning insight
 */

import { getSupabaseClient } from '@/lib/db/supabase';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { loadConfig } from '@/lib/config';
import { logger } from '@/lib/logger';
import type { LearningInsight, DiscoveredSkill } from '@/types';

// Feedback
import {
  submitFeedback,
  getFeedback,
  getFeedbackStats,
  aggregateFeedbackForConversation,
  updateFeedback,
  deleteFeedback,
  FeedbackSubmitSchema,
  FeedbackQuerySchema,
  FeedbackStatsQuerySchema,
} from '@/lib/learning/feedback-loop';

// Preference Drift
import {
  capturePreferenceSnapshot,
  detectPreferenceDrift,
  getLatestDriftReport,
  getSnapshots,
  analyzeSemanticDrift,
  SnapshotInputSchema,
  DriftQuerySchema,
} from '@/lib/learning/preference-drift';

// Memory Consolidation
import {
  runConsolidation,
  retrieveConsolidatedMemories,
  compressMemories,
  deleteMemorySummary,
  ConsolidationConfigSchema,
} from '@/lib/learning/memory-consolidation';

// Skill Discovery
import {
  discoverSkills,
  getDiscoveredSkills,
  getDiscoveredSkillById,
  evaluateSkill,
  markSkillAsImplemented,
  getSkillRecommendations,
  SkillDiscoveryInputSchema,
  SkillEvaluateInputSchema,
} from '@/lib/learning/skill-discovery';

// Training Prep
import {
  exportTrainingDataset,
  getTrainingDataset,
  listTrainingDatasets,
  getTrainingExamples,
  ExportConfigSchema,
} from '@/lib/learning/training-prep';

const config = loadConfig();

// ---------------------------------------------------------------------------
// POST Handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const operation = searchParams.get('op');
    const body = await request.json().catch(() => ({}));

    switch (operation) {
      // ---------------------------------------------------------------
      // Feedback
      // ---------------------------------------------------------------
      case 'feedback': {
        const parsed = FeedbackSubmitSchema.parse(body);
        const entry = await submitFeedback(parsed);
        return NextResponse.json({ success: true, feedback: entry });
      }

      case 'feedback_update': {
        const { id, ...updates } = body;
        if (!id || typeof id !== 'string') {
          return NextResponse.json({ error: 'Missing feedback id' }, { status: 400 });
        }
        const entry = await updateFeedback(id, updates);
        return NextResponse.json({ success: true, feedback: entry });
      }

      case 'feedback_delete': {
        const { id } = body;
        if (!id || typeof id !== 'string') {
          return NextResponse.json({ error: 'Missing feedback id' }, { status: 400 });
        }
        await deleteFeedback(id);
        return NextResponse.json({ success: true });
      }

      // ---------------------------------------------------------------
      // Preference Snapshots
      // ---------------------------------------------------------------
      case 'snapshot': {
        const parsed = SnapshotInputSchema.parse(body);
        const snapshot = await capturePreferenceSnapshot(parsed);
        return NextResponse.json({ success: true, snapshot });
      }

      // ---------------------------------------------------------------
      // Memory Consolidation
      // ---------------------------------------------------------------
      case 'consolidate': {
        const parsed = ConsolidationConfigSchema.parse(body);
        const result = await runConsolidation(parsed);
        return NextResponse.json({ success: true, result });
      }

      case 'compress_memories': {
        const { userId, summaryIds } = body;
        if (!userId || !Array.isArray(summaryIds)) {
          return NextResponse.json({ error: 'Missing userId or summaryIds' }, { status: 400 });
        }
        const { retrieveConsolidatedMemories } = await import('@/lib/learning/memory-consolidation');
        const memories = await retrieveConsolidatedMemories(userId);
        const selected = memories.filter((m) => summaryIds.includes(m.id));
        if (selected.length === 0) {
          return NextResponse.json({ error: 'No matching memories found' }, { status: 404 });
        }
        const compressed = await compressMemories(selected, userId);
        return NextResponse.json({ success: true, compressed });
      }

      case 'delete_memory': {
        const { summaryId } = body;
        if (!summaryId || typeof summaryId !== 'string') {
          return NextResponse.json({ error: 'Missing summaryId' }, { status: 400 });
        }
        await deleteMemorySummary(summaryId);
        return NextResponse.json({ success: true });
      }

      // ---------------------------------------------------------------
      // Skill Discovery
      // ---------------------------------------------------------------
      case 'discover': {
        const parsed = SkillDiscoveryInputSchema.parse(body);
        const skills = await discoverSkills(parsed);
        return NextResponse.json({ success: true, skills });
      }

      case 'skill_evaluate': {
        const parsed = SkillEvaluateInputSchema.parse(body);
        const skill = await evaluateSkill(parsed);
        return NextResponse.json({ success: true, skill });
      }

      case 'skill_implement': {
        const { skillId, notes } = body;
        if (!skillId || typeof skillId !== 'string') {
          return NextResponse.json({ error: 'Missing skillId' }, { status: 400 });
        }
        const skill = await markSkillAsImplemented(skillId, notes);
        return NextResponse.json({ success: true, skill });
      }

      // ---------------------------------------------------------------
      // Training Dataset Export
      // ---------------------------------------------------------------
      case 'export': {
        const parsed = ExportConfigSchema.parse(body);
        const result = await exportTrainingDataset(parsed);
        return NextResponse.json({ success: true, result });
      }

      default:
        return NextResponse.json(
          { error: `Unknown operation: ${operation}` },
          { status: 400 }
        );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('[API /learning] POST Error:', { error: message });

    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation failed', details: err.flatten() },
        { status: 400 }
      );
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// GET Handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const operation = searchParams.get('op');

    switch (operation) {
      // ---------------------------------------------------------------
      // Feedback
      // ---------------------------------------------------------------
      case 'feedback': {
        const query = {
          userId: searchParams.get('userId') ?? '',
          conversationId: searchParams.get('conversationId') ?? undefined,
          messageId: searchParams.get('messageId') ?? undefined,
          startDate: searchParams.get('startDate') ?? undefined,
          endDate: searchParams.get('endDate') ?? undefined,
          limit: parseInt(searchParams.get('limit') ?? '50', 10),
          offset: parseInt(searchParams.get('offset') ?? '0', 10),
        };
        const parsed = FeedbackQuerySchema.parse(query);
        const entries = await getFeedback(parsed);
        return NextResponse.json({ success: true, feedback: entries });
      }

      case 'feedback_stats': {
        const query = {
          userId: searchParams.get('userId') ?? '',
          conversationId: searchParams.get('conversationId') ?? undefined,
          days: parseInt(searchParams.get('days') ?? '30', 10),
        };
        const parsed = FeedbackStatsQuerySchema.parse(query);
        const stats = await getFeedbackStats(parsed);
        return NextResponse.json({ success: true, stats });
      }

      case 'feedback_conversation': {
        const conversationId = searchParams.get('conversationId');
        if (!conversationId) {
          return NextResponse.json({ error: 'Missing conversationId' }, { status: 400 });
        }
        const aggregate = await aggregateFeedbackForConversation(conversationId);
        return NextResponse.json({ success: true, aggregate });
      }

      // ---------------------------------------------------------------
      // Preference Drift
      // ---------------------------------------------------------------
      case 'drift': {
        const userId = searchParams.get('userId');
        if (!userId) {
          return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
        }
        const report = await getLatestDriftReport(userId);
        return NextResponse.json({ success: true, report });
      }

      case 'drift_detect': {
        const query = {
          userId: searchParams.get('userId') ?? '',
          lookbackDays: parseInt(searchParams.get('lookbackDays') ?? '30', 10),
          minSnapshots: parseInt(searchParams.get('minSnapshots') ?? '2', 10),
          driftThreshold: parseFloat(searchParams.get('driftThreshold') ?? '0.3'),
        };
        const parsed = DriftQuerySchema.parse(query);
        const report = await detectPreferenceDrift(parsed);
        return NextResponse.json({ success: true, report });
      }

      case 'snapshots': {
        const userId = searchParams.get('userId');
        if (!userId) {
          return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
        }
        const snapshots = await getSnapshots(userId, {
          startDate: searchParams.get('startDate') ?? undefined,
          endDate: searchParams.get('endDate') ?? undefined,
          limit: parseInt(searchParams.get('limit') ?? '20', 10),
          offset: parseInt(searchParams.get('offset') ?? '0', 10),
        });
        return NextResponse.json({ success: true, snapshots });
      }

      case 'semantic_drift': {
        const userId = searchParams.get('userId');
        if (!userId) {
          return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
        }
        const lookbackDays = parseInt(searchParams.get('lookbackDays') ?? '30', 10);
        const analysis = await analyzeSemanticDrift(userId, lookbackDays);
        return NextResponse.json({ success: true, analysis });
      }

      // ---------------------------------------------------------------
      // Memories
      // ---------------------------------------------------------------
      case 'memories': {
        const userId = searchParams.get('userId');
        if (!userId) {
          return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
        }
        const memories = await retrieveConsolidatedMemories(userId, {
          namespace: searchParams.get('namespace') ?? undefined,
          limit: parseInt(searchParams.get('limit') ?? '20', 10),
          query: searchParams.get('query') ?? undefined,
        });
        return NextResponse.json({ success: true, memories });
      }

      // ---------------------------------------------------------------
      // Skills
      // ---------------------------------------------------------------
      case 'skills': {
        const userId = searchParams.get('userId');
        if (!userId) {
          return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
        }
        const skills = await getDiscoveredSkills(userId, {
          status: (searchParams.get('status') as DiscoveredSkill['status']) ?? undefined,
          category: searchParams.get('category') ?? undefined,
          limit: parseInt(searchParams.get('limit') ?? '20', 10),
          offset: parseInt(searchParams.get('offset') ?? '0', 10),
        });
        return NextResponse.json({ success: true, skills });
      }

      case 'skill': {
        const skillId = searchParams.get('skillId');
        if (!skillId) {
          return NextResponse.json({ error: 'Missing skillId' }, { status: 400 });
        }
        const skill = await getDiscoveredSkillById(skillId);
        if (!skill) {
          return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
        }
        return NextResponse.json({ success: true, skill });
      }

      case 'skill_recommendations': {
        const userId = searchParams.get('userId');
        if (!userId) {
          return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
        }
        const limit = parseInt(searchParams.get('limit') ?? '5', 10);
        const recommendations = await getSkillRecommendations(userId, limit);
        return NextResponse.json({ success: true, recommendations });
      }

      // ---------------------------------------------------------------
      // Training Datasets
      // ---------------------------------------------------------------
      case 'dataset': {
        const datasetId = searchParams.get('datasetId');
        if (!datasetId) {
          return NextResponse.json({ error: 'Missing datasetId' }, { status: 400 });
        }
        const dataset = await getTrainingDataset(datasetId);
        if (!dataset) {
          return NextResponse.json({ error: 'Dataset not found' }, { status: 404 });
        }
        return NextResponse.json({ success: true, dataset });
      }

      case 'datasets': {
        const userId = searchParams.get('userId');
        if (!userId) {
          return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
        }
        const datasets = await listTrainingDatasets(userId, {
          limit: parseInt(searchParams.get('limit') ?? '20', 10),
          offset: parseInt(searchParams.get('offset') ?? '0', 10),
        });
        return NextResponse.json({ success: true, datasets });
      }

      case 'dataset_examples': {
        const datasetId = searchParams.get('datasetId');
        if (!datasetId) {
          return NextResponse.json({ error: 'Missing datasetId' }, { status: 400 });
        }
        const dataset = await getTrainingDataset(datasetId);
        if (!dataset) {
          return NextResponse.json({ error: 'Dataset not found' }, { status: 404 });
        }
        const examples = await getTrainingExamples(dataset.exampleIds, {
          limit: parseInt(searchParams.get('limit') ?? '100', 10),
        });
        return NextResponse.json({ success: true, examples });
      }

      // ---------------------------------------------------------------
      // Composite Learning Insight
      // ---------------------------------------------------------------
      case 'insights': {
        const userId = searchParams.get('userId');
        if (!userId) {
          return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
        }
        const period = (searchParams.get('period') as 'daily' | 'weekly' | 'monthly') ?? 'weekly';
        const insight = await buildLearningInsight(userId, period);
        return NextResponse.json({ success: true, insight });
      }

      default:
        return NextResponse.json(
          { error: `Unknown operation: ${operation}` },
          { status: 400 }
        );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('[API /learning] GET Error:', { error: message });

    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation failed', details: err.flatten() },
        { status: 400 }
      );
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Composite Learning Insight Builder
// ---------------------------------------------------------------------------

async function buildLearningInsight(
  userId: string,
  period: 'daily' | 'weekly' | 'monthly'
): Promise<LearningInsight> {
  const sb = getSupabaseClient();

  const days = period === 'daily' ? 1 : period === 'weekly' ? 7 : 30;
  const since = new Date();
  since.setDate(since.getDate() - days);

  // Conversation stats
  const { data: convs, error: convErr } = await sb
    .from('conversations')
    .select('id, messages(count)')
    .eq('user_id', userId)
    .gte('updated_at', since.toISOString());

  if (convErr) logger.warn('Insight: failed to load conversations', { error: convErr });

  const totalConversations = (convs ?? []).length;
  const totalMessages = (convs ?? []).reduce(
    (sum, c) => sum + Number(c.messages?.[0]?.count ?? 0),
    0
  );

  // Feedback stats
  const feedbackStats = await getFeedbackStats({ userId, days });

  // Discovered skills
  const discoveredSkills = await getDiscoveredSkills(userId, { limit: 10 });

  // Top topics from memory summaries
  const { data: summaries, error: summaryErr } = await sb
    .from('memory_summaries')
    .select('topics')
    .eq('user_id', userId)
    .gte('created_at', since.toISOString());

  const topicCounts = new Map<string, number>();
  if (!summaryErr) {
    for (const row of summaries ?? []) {
      for (const topic of (row.topics as string[]) ?? []) {
        topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
      }
    }
  }
  const topTopics = [...topicCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([topic]) => topic);

  // Preference changes from latest drift report
  const driftReport = await getLatestDriftReport(userId);
  const preferenceChanges = driftReport?.driftedFields ?? [];

  // Recommended actions
  const recommendedActions: string[] = [];
  if (feedbackStats.trendDirection === 'declining') {
    recommendedActions.push('Response quality is declining. Review recent negative feedback and consider retraining.');
  }
  if (discoveredSkills.some((s) => s.priority === 'high' || s.priority === 'critical')) {
    recommendedActions.push('High-priority skills have been discovered. Evaluate for implementation.');
  }
  if (preferenceChanges.length > 0) {
    recommendedActions.push('User preferences have shifted. Update personalization models.');
  }
  if (recommendedActions.length === 0) {
    recommendedActions.push('No immediate action required. Continue monitoring.');
  }

  return {
    userId,
    period,
    totalConversations,
    totalMessages,
    feedbackStats,
    discoveredSkills,
    topTopics,
    preferenceChanges,
    recommendedActions,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// OPTIONS (CORS preflight)
// ---------------------------------------------------------------------------

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
