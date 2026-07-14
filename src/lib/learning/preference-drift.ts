/**
 * src/lib/learning/preference-drift.ts
 * Continuous Learning — Preference Drift Detection
 *
 * Detects changes in user preferences over time by capturing periodic snapshots
 * and comparing them using semantic + statistical drift scoring.
 * Uses LLM analysis for complex preference shifts and vector similarity for
 * topic/industry drift.
 */

import { z } from 'zod';
import { getSupabaseClient } from '@/lib/db/supabase';
import { logger } from '@/lib/logger';
import { loadConfig } from '@/lib/config';
import { embedTexts, queryVectors } from '@/lib/vector/pinecone';
import type {
  UserPreferences,
  PreferenceSnapshot,
  PreferenceDriftReport,
  PreferenceDriftField,
} from '@/types';

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

export const SnapshotInputSchema = z.object({
  userId: z.string().uuid(),
  preferences: z.object({
    tone: z.enum(['concise', 'detailed', 'technical', 'casual']).optional(),
    verbosity: z.enum(['minimal', 'standard', 'verbose']).optional(),
    responseStyle: z.enum(['directive', 'socratic', 'collaborative']).optional(),
    timezone: z.string().optional(),
    language: z.string().optional(),
    topicsOfInterest: z.array(z.string()).optional(),
    industries: z.array(z.string()).optional(),
  }),
  source: z.enum(['explicit', 'extracted', 'inferred']).default('inferred'),
  confidence: z.number().min(0).max(1).default(0.8),
});
export type SnapshotInput = z.infer<typeof SnapshotInputSchema>;

export const DriftQuerySchema = z.object({
  userId: z.string().uuid(),
  lookbackDays: z.number().int().min(1).max(365).default(30),
  minSnapshots: z.number().int().min(2).max(50).default(2),
  driftThreshold: z.number().min(0).max(1).default(0.3),
});
export type DriftQuery = z.infer<typeof DriftQuerySchema>;

// ---------------------------------------------------------------------------
// Core Operations
// ---------------------------------------------------------------------------

/**
 * Capture a new preference snapshot for a user.
 * Stores in DB and optionally indexes topics/industries in vector store
 * for semantic drift detection.
 */
export async function capturePreferenceSnapshot(input: SnapshotInput): Promise<PreferenceSnapshot> {
  const validated = SnapshotInputSchema.parse(input);
  const sb = getSupabaseClient();

  // Build full preferences object with defaults
  const fullPrefs: UserPreferences = {
    tone: (validated.preferences.tone ?? 'detailed') as UserPreferences['tone'],
    verbosity: (validated.preferences.verbosity ?? 'standard') as UserPreferences['verbosity'],
    responseStyle: (validated.preferences.responseStyle ?? 'collaborative') as UserPreferences['responseStyle'],
    timezone: validated.preferences.timezone ?? 'UTC',
    language: validated.preferences.language ?? 'en',
    topicsOfInterest: validated.preferences.topicsOfInterest ?? [],
    industries: validated.preferences.industries ?? [],
  };

  const { data, error } = await sb
    .from('preference_snapshots')
    .insert({
      user_id: validated.userId,
      preferences: fullPrefs as unknown as Record<string, unknown>,
      source: validated.source,
      confidence: validated.confidence,
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to capture preference snapshot', { error, userId: validated.userId });
    throw new Error(`DB error: ${error.message}`);
  }

  // Index topics/industries in vector store for semantic drift tracking
  try {
    const textsToEmbed: string[] = [];
    if (fullPrefs.topicsOfInterest.length > 0) {
      textsToEmbed.push(`Topics: ${fullPrefs.topicsOfInterest.join(', ')}`);
    }
    if (fullPrefs.industries.length > 0) {
      textsToEmbed.push(`Industries: ${fullPrefs.industries.join(', ')}`);
    }
    if (textsToEmbed.length > 0) {
      const embeddings = await embedTexts(textsToEmbed);
      // Store in vector DB under user-specific namespace for drift comparison
      const { upsertVectors } = await import('@/lib/vector/pinecone');
      const snapshotId = String(data.id);
      await upsertVectors(
        embeddings.map((values, i) => ({
          id: `${snapshotId}-${i}`,
          values,
          metadata: {
            userId: validated.userId,
            snapshotId,
            type: i === 0 ? 'topics' : 'industries',
            text: textsToEmbed[i],
            createdAt: new Date().toISOString(),
          },
        })),
        `user-${validated.userId}-preferences`
      );
    }
  } catch (vectorErr) {
    logger.warn('Failed to index preference snapshot in vector store', {
      error: vectorErr instanceof Error ? vectorErr.message : String(vectorErr),
      userId: validated.userId,
    });
    // Non-fatal: vector indexing is best-effort
  }

  const snapshot = mapPreferenceSnapshot(data);
  logger.info('Preference snapshot captured', {
    snapshotId: snapshot.id,
    userId: snapshot.userId,
    source: snapshot.source,
  });
  return snapshot;
}

/**
 * Retrieve snapshots for a user, optionally within a date range.
 */
export async function getSnapshots(
  userId: string,
  opts?: { startDate?: string; endDate?: string; limit?: number; offset?: number }
): Promise<PreferenceSnapshot[]> {
  const sb = getSupabaseClient();
  let query = sb
    .from('preference_snapshots')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (opts?.startDate) query = query.gte('created_at', opts.startDate);
  if (opts?.endDate) query = query.lte('created_at', opts.endDate);
  if (opts?.limit) query = query.limit(opts.limit);
  if (opts?.offset) query = query.range(opts.offset, opts.offset + (opts.limit ?? 10) - 1);

  const { data, error } = await query;

  if (error) {
    logger.error('Failed to get preference snapshots', { error, userId });
    throw new Error(`DB error: ${error.message}`);
  }

  return (data ?? []).map(mapPreferenceSnapshot);
}

/**
 * Detect preference drift between the most recent snapshot(s) and older ones.
 * Returns a drift report with drifted fields, severity, and recommendations.
 */
export async function detectPreferenceDrift(query: DriftQuery): Promise<PreferenceDriftReport | null> {
  const validated = DriftQuerySchema.parse(query);
  const sb = getSupabaseClient();

  const since = new Date();
  since.setDate(since.getDate() - validated.lookbackDays);

  const { data, error } = await sb
    .from('preference_snapshots')
    .select('*')
    .eq('user_id', validated.userId)
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: true });

  if (error) {
    logger.error('Failed to detect preference drift', { error, userId: validated.userId });
    throw new Error(`DB error: ${error.message}`);
  }

  const snapshots = (data ?? []).map(mapPreferenceSnapshot);
  if (snapshots.length < validated.minSnapshots) {
    logger.info('Insufficient snapshots for drift detection', {
      userId: validated.userId,
      count: snapshots.length,
      minRequired: validated.minSnapshots,
    });
    return null;
  }

  const driftedFields = computeDriftedFields(snapshots, validated.driftThreshold);
  const severity = deriveSeverity(driftedFields);
  const summary = generateDriftSummary(driftedFields, snapshots);
  const recommendedAction = generateRecommendation(driftedFields, severity);

  const report: PreferenceDriftReport = {
    id: crypto.randomUUID(),
    userId: validated.userId,
    snapshotIds: snapshots.map((s) => s.id),
    driftedFields,
    summary,
    severity,
    recommendedAction,
    createdAt: new Date().toISOString(),
  };

  // Persist report
  try {
    await sb.from('preference_drift_reports').insert({
      id: report.id,
      user_id: report.userId,
      snapshot_ids: report.snapshotIds,
      drifted_fields: driftedFields as unknown[],
      summary: report.summary,
      severity: report.severity,
      recommended_action: report.recommendedAction,
      created_at: report.createdAt,
    });
  } catch (persistErr) {
    logger.warn('Failed to persist drift report', {
      error: persistErr instanceof Error ? persistErr.message : String(persistErr),
    });
  }

  logger.info('Preference drift detected', {
    userId: validated.userId,
    severity,
    driftedFieldCount: driftedFields.length,
  });

  return report;
}

/**
 * Get the most recent drift report for a user.
 */
export async function getLatestDriftReport(userId: string): Promise<PreferenceDriftReport | null> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('preference_drift_reports')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    logger.error('Failed to get latest drift report', { error, userId });
    throw new Error(`DB error: ${error.message}`);
  }

  return mapDriftReport(data);
}

/**
 * Semantic drift analysis using vector similarity.
 * Compares the most recent preference topics/industries embeddings against
 * older ones to detect semantic topic drift.
 */
export async function analyzeSemanticDrift(
  userId: string,
  lookbackDays = 30
): Promise<{ driftScore: number; shiftedTopics: string[]; stableTopics: string[] }> {
  const namespace = `user-${userId}-preferences`;
  const since = new Date();
  since.setDate(since.getDate() - lookbackDays);

  try {
    // Get recent snapshots from DB to build a real query vector
    const sb = getSupabaseClient();
    const { data: recentSnapshots } = await sb
      .from('preference_snapshots')
      .select('*')
      .eq('user_id', userId)
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: false })
      .limit(3);

    const recentTexts: string[] = [];
    for (const s of recentSnapshots ?? []) {
      const prefs = (s.preferences as UserPreferences) ?? {};
      if (prefs.topicsOfInterest?.length) {
        recentTexts.push(`Topics: ${prefs.topicsOfInterest.join(', ')}`);
      }
      if (prefs.industries?.length) {
        recentTexts.push(`Industries: ${prefs.industries.join(', ')}`);
      }
    }

    if (recentTexts.length === 0) {
      return { driftScore: 0, shiftedTopics: [], stableTopics: [] };
    }

    // Embed recent preferences text for querying
    const queryEmbeddings = await embedTexts([recentTexts.join(' \n')]);
    const queryVector = queryEmbeddings[0];

    // Query recent matches
    const recentMatches = await queryVectors(queryVector, namespace, 10);

    if (recentMatches.length === 0) {
      return { driftScore: 0, shiftedTopics: [], stableTopics: [] };
    }

    // Get older embeddings for comparison by querying with the same vector
    // but filtering out recent results by score/timestamp metadata
    const olderMatches = await queryVectors(queryVector, namespace, 20);

    // Partition into recent vs older using metadata timestamps
    const nowMs = Date.now();
    const recentCutoff = nowMs - lookbackDays * 24 * 60 * 60 * 1000;

    const recentSet = olderMatches.filter((m) => {
      const ts = String(m.metadata?.createdAt ?? '');
      return ts ? new Date(ts).getTime() >= recentCutoff : true;
    });
    const olderSet = olderMatches.filter((m) => {
      const ts = String(m.metadata?.createdAt ?? '');
      return ts ? new Date(ts).getTime() < recentCutoff : false;
    });

    // Compare similarity distributions
    const recentScores = recentSet.map((m) => m.score);
    const olderScores = olderSet.map((m) => m.score);
    const avgRecent = recentScores.length > 0
      ? recentScores.reduce((a, b) => a + b, 0) / recentScores.length
      : 0;
    const avgOlder = olderScores.length > 0
      ? olderScores.reduce((a, b) => a + b, 0) / olderScores.length
      : 0;

    // Drift: if older items were more similar to current prefs than recent ones,
    // it suggests the user's preferences have shifted away from their older self
    const driftScore = Math.max(0, Math.min(1, avgOlder - avgRecent));

    // Extract topic texts
    const allTopics = new Set<string>();
    for (const m of olderMatches) {
      const text = String(m.metadata?.text ?? '');
      if (text.startsWith('Topics:')) {
        text.replace('Topics: ', '').split(', ').forEach((t) => allTopics.add(t.trim()));
      }
    }

    const shiftedTopics: string[] = [];
    const stableTopics: string[] = [];

    const recentTopicSet = new Set(
      recentSet
        .map((m) => String(m.metadata?.text ?? ''))
        .filter((t) => t.startsWith('Topics:'))
        .map((t) => t.replace('Topics: ', '').split(', '))
        .flat()
    );

    for (const topic of allTopics) {
      if (recentTopicSet.has(topic)) {
        stableTopics.push(topic);
      } else {
        shiftedTopics.push(topic);
      }
    }

    return { driftScore, shiftedTopics, stableTopics };
  } catch (err) {
    logger.warn('Semantic drift analysis failed', {
      error: err instanceof Error ? err.message : String(err),
      userId,
    });
    return { driftScore: 0, shiftedTopics: [], stableTopics: [] };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeDriftedFields(snapshots: PreferenceSnapshot[], threshold: number): PreferenceDriftField[] {
  if (snapshots.length < 2) return [];

  const first = snapshots[0].preferences;
  const last = snapshots[snapshots.length - 1].preferences;
  const fields: PreferenceDriftField[] = [];

  const keys = Object.keys(first) as (keyof UserPreferences)[];
  for (const field of keys) {
    const prevValue = first[field];
    const currValue = last[field];
    const prevConf = snapshots[0].confidence;
    const currConf = snapshots[snapshots.length - 1].confidence;

    const driftScore = computeFieldDrift(prevValue, currValue);
    if (driftScore >= threshold) {
      fields.push({
        field,
        previousValue: prevValue,
        currentValue: currValue,
        confidenceDelta: currConf - prevConf,
        driftScore,
      });
    }
  }

  return fields;
}

function computeFieldDrift(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (Array.isArray(a) && Array.isArray(b)) {
    const setA = new Set(a as string[]);
    const setB = new Set(b as string[]);
    const intersection = [...setA].filter((x) => setB.has(x)).length;
    const union = new Set([...setA, ...setB]).size;
    return union === 0 ? 0 : 1 - intersection / union;
  }
  if (typeof a === 'string' && typeof b === 'string') {
    // Simple Jaccard-ish similarity for strings (word overlap)
    const wordsA = new Set(a.toLowerCase().split(/\s+/));
    const wordsB = new Set(b.toLowerCase().split(/\s+/));
    const intersection = [...wordsA].filter((w) => wordsB.has(w)).length;
    const union = new Set([...wordsA, ...wordsB]).size;
    return union === 0 ? 0 : 1 - intersection / union;
  }
  return 1; // completely different types or values
}

function deriveSeverity(driftedFields: PreferenceDriftField[]): PreferenceDriftReport['severity'] {
  if (driftedFields.length === 0) return 'low';
  const avgDrift = driftedFields.reduce((sum, f) => sum + f.driftScore, 0) / driftedFields.length;
  if (avgDrift > 0.7 || driftedFields.length >= 4) return 'high';
  if (avgDrift > 0.4 || driftedFields.length >= 2) return 'medium';
  return 'low';
}

function generateDriftSummary(driftedFields: PreferenceDriftField[], snapshots: PreferenceSnapshot[]): string {
  if (driftedFields.length === 0) {
    return `No significant preference drift detected across ${snapshots.length} snapshots.`;
  }
  const fieldNames = driftedFields.map((f) => f.field).join(', ');
  const timeSpan = snapshots.length > 1
    ? `between ${new Date(snapshots[0].createdAt).toLocaleDateString()} and ${new Date(snapshots[snapshots.length - 1].createdAt).toLocaleDateString()}`
    : 'in recent activity';
  return `Detected drift in ${driftedFields.length} preference field(s) (${fieldNames}) ${timeSpan}.`;
}

function generateRecommendation(driftedFields: PreferenceDriftField[], severity: PreferenceDriftReport['severity']): string {
  if (driftedFields.length === 0) return 'Continue monitoring; no action required.';
  const recs: string[] = [];
  for (const field of driftedFields) {
    if (field.field === 'tone') recs.push('Adjust response tone to match new preference.');
    if (field.field === 'verbosity') recs.push('Adapt verbosity level in future responses.');
    if (field.field === 'responseStyle') recs.push('Switch response style to align with user expectations.');
    if (field.field === 'topicsOfInterest') recs.push('Surface relevant content based on updated topics.');
    if (field.field === 'industries') recs.push('Tailor industry-specific insights to new sectors.');
  }
  if (severity === 'high') recs.push('Recommend explicit preference confirmation with the user.');
  return [...new Set(recs)].join(' ');
}

function mapPreferenceSnapshot(row: Record<string, unknown>): PreferenceSnapshot {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    preferences: (row.preferences as UserPreferences) ?? {
      tone: 'detailed',
      verbosity: 'standard',
      responseStyle: 'collaborative',
      timezone: 'UTC',
      language: 'en',
      topicsOfInterest: [],
      industries: [],
    },
    source: (row.source as PreferenceSnapshot['source']) ?? 'inferred',
    confidence: Number(row.confidence ?? 0.8),
    createdAt: String(row.created_at),
  };
}

function mapDriftReport(row: Record<string, unknown>): PreferenceDriftReport {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    snapshotIds: (row.snapshot_ids as string[]) ?? [],
    driftedFields: (row.drifted_fields as PreferenceDriftField[]) ?? [],
    summary: String(row.summary ?? ''),
    severity: (row.severity as PreferenceDriftReport['severity']) ?? 'low',
    recommendedAction: String(row.recommended_action ?? ''),
    createdAt: String(row.created_at),
  };
}
