/**
 * Daily Digest Generator
 * ======================
 * Aggregates recent news items into structured intelligence briefings.
 * Supports daily, weekly, and event-triggered digests.
 *
 * Flow:
 * 1. Query news_items from time window (default: last 24h)
 * 2. Categorize and rank by relevance
 * 3. Generate markdown digest body
 * 4. Store in `digests` table
 * 5. Enqueue delivery jobs (email / Slack / webhook)
 */

import { z } from 'zod';
import type { SupabaseConfig } from './rss';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const DigestSectionSchema = z.object({
  category: z.string(),
  headline: z.string(),
  items: z.array(z.object({
    title: z.string(),
    url: z.string(),
    summary: z.string(),
    source: z.string(),
    publishedAt: z.string(),
  })),
});

export type DigestSection = z.infer<typeof DigestSectionSchema>;

export const GeneratedDigestSchema = z.object({
  title: z.string(),
  sections: z.array(DigestSectionSchema),
  sources: z.array(z.string()),
  totalItems: z.number().int(),
  generatedAt: z.string(),
});

export type GeneratedDigest = z.infer<typeof GeneratedDigestSchema>;

export const DigestSubscriptionSchema = z.object({
  user_id: z.string().uuid(),
  type: z.enum(['daily', 'weekly', 'event']),
  is_enabled: z.boolean(),
  channels: z.array(z.string()),
  timezone: z.string(),
  categories: z.array(z.string()),
  max_items: z.number().int().default(10),
});

export type DigestSubscription = z.infer<typeof DigestSubscriptionSchema>;

// ---------------------------------------------------------------------------
// Supabase helpers
// ---------------------------------------------------------------------------

function supabaseHeaders(cfg: SupabaseConfig): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'apikey': cfg.serviceKey,
    'Authorization': `Bearer ${cfg.serviceKey}`,
  };
}

export async function fetchRecentNews(
  cfg: SupabaseConfig,
  opts: {
    since: string;
    categories?: string[];
    limit?: number;
  }
): Promise<Array<{
  id: string;
  title: string;
  url: string;
  summary: string;
  source_name: string;
  category: string;
  tags: string[];
  published_at: string;
}>> {
  const params = new URLSearchParams();
  params.set('select', 'id,title,url,summary,source_name,category,tags,published_at');
  params.set('fetched_at', `gte.${opts.since}`);
  params.set('order', 'published_at.desc');
  params.set('limit', String(opts.limit || 100));

  if (opts.categories && opts.categories.length > 0) {
    params.set('category', `in.(${opts.categories.join(',')})`);
  }

  const url = `${cfg.url}/rest/v1/news_items?${params.toString()}`;
  const res = await fetch(url, { headers: supabaseHeaders(cfg) });
  if (!res.ok) throw new Error(`Failed to fetch news: ${res.status}`);
  return (await res.json()) as unknown[] as ReturnType<typeof fetchRecentNews> extends Promise<infer T> ? T : never;
}

export async function fetchActiveSubscriptions(cfg: SupabaseConfig): Promise<DigestSubscription[]> {
  const url = `${cfg.url}/rest/v1/digest_subscriptions?is_enabled=eq.true&select=*`;
  const res = await fetch(url, { headers: supabaseHeaders(cfg) });
  if (!res.ok) throw new Error(`Failed to fetch subscriptions: ${res.status}`);
  const data = await res.json() as unknown[];
  return data.map((d) => DigestSubscriptionSchema.parse(d));
}

export async function storeDigest(
  cfg: SupabaseConfig,
  payload: {
    user_id: string;
    type: 'daily' | 'weekly' | 'event';
    title: string;
    content: string;
    sources: string[];
    news_item_ids: string[];
    metrics?: Record<string, unknown>;
  }
): Promise<{ id: string }> {
  const res = await fetch(`${cfg.url}/rest/v1/digests`, {
    method: 'POST',
    headers: {
      ...supabaseHeaders(cfg),
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Failed to store digest: ${res.status}`);
  const rows = (await res.json()) as Array<{ id: string }>;
  return rows[0];
}

export async function insertQueueJob(
  cfg: SupabaseConfig,
  name: string,
  data: Record<string, unknown>,
  opts?: { scheduledFor?: string; priority?: number }
): Promise<void> {
  const res = await fetch(`${cfg.url}/rest/v1/job_queue`, {
    method: 'POST',
    headers: supabaseHeaders(cfg),
    body: JSON.stringify({
      name,
      data,
      state: 'pending',
      scheduled_for: opts?.scheduledFor || new Date().toISOString(),
      priority: opts?.priority || 0,
    }),
  });
  if (!res.ok) throw new Error(`Failed to insert queue job: ${res.status}`);
}

export async function recordMetric(
  cfg: SupabaseConfig,
  metricName: string,
  value: number,
  dimension?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  const res = await fetch(`${cfg.url}/rest/v1/rpc/record_metric`, {
    method: 'POST',
    headers: supabaseHeaders(cfg),
    body: JSON.stringify({
      p_metric_name: metricName,
      p_metric_value: value,
      p_dimension: dimension || null,
      p_metadata: metadata || {},
    }),
  });
  if (!res.ok) {
    // Non-critical: log but don't throw
    console.warn(`Failed to record metric ${metricName}: ${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// Digest assembly engine
// ---------------------------------------------------------------------------

/**
 * Group news items into category sections.
 */
function categorizeItems(
  items: Awaited<ReturnType<typeof fetchRecentNews>>
): Map<string, typeof items> {
  const map = new Map<string, typeof items>();
  for (const item of items) {
    const key = item.category || 'general';
    const list = map.get(key) || [];
    list.push(item);
    map.set(key, list);
  }
  return map;
}

/**
 * Build a plain-text / markdown digest from categorized items.
 */
export function buildDigestMarkdown(
  title: string,
  sections: DigestSection[],
  meta: { generatedAt: string; totalItems: number }
): string {
  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`_Generated: ${meta.generatedAt} | ${meta.totalItems} stories_`);
  lines.push('');

  for (const section of sections) {
    lines.push(`## ${section.headline}`);
    lines.push('');
    for (const item of section.items) {
      lines.push(`**${item.title}**  `); // two spaces for line break in markdown
      lines.push(`${item.summary || 'No summary available.'}  `);
      lines.push(`_[${item.source}](${item.url}) | ${new Date(item.publishedAt).toLocaleDateString()}_  `);
      lines.push('');
    }
  }

  lines.push('---');
  lines.push('_Shadow Brain Chief of Staff — Automated Intelligence Briefing_');
  return lines.join('\n');
}

/**
 * Build a structured digest object from raw news items.
 */
export function assembleDigest(
  items: Awaited<ReturnType<typeof fetchRecentNews>>,
  opts?: { maxItemsPerCategory?: number }
): GeneratedDigest {
  const maxPerCat = opts?.maxItemsPerCategory ?? 10;
  const categorized = categorizeItems(items);

  const sections: DigestSection[] = [];
  const sourceSet = new Set<string>();

  for (const [category, catItems] of categorized.entries()) {
    const trimmed = catItems.slice(0, maxPerCat);
    sections.push({
      category,
      headline: `${category.charAt(0).toUpperCase() + category.slice(1)} Brief`,
      items: trimmed.map((i) => ({
        title: i.title,
        url: i.url,
        summary: i.summary || '',
        source: i.source_name || 'Unknown',
        publishedAt: i.published_at,
      })),
    });
    for (const i of trimmed) {
      if (i.source_name) sourceSet.add(i.source_name);
    }
  }

  return {
    title: `Shadow Brain Daily Digest — ${new Date().toLocaleDateString()}`,
    sections,
    sources: Array.from(sourceSet),
    totalItems: items.length,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Main generation pipeline
// ---------------------------------------------------------------------------

export interface GenerateDigestsResult {
  digestsCreated: number;
  jobsEnqueued: number;
  errors: string[];
}

export async function generateDailyDigests(
  cfg: SupabaseConfig,
  opts?: { lookbackHours?: number; dryRun?: boolean }
): Promise<GenerateDigestsResult> {
  const lookback = opts?.lookbackHours ?? 24;
  const since = new Date(Date.now() - lookback * 60 * 60 * 1000).toISOString();

  const errors: string[] = [];
  let digestsCreated = 0;
  let jobsEnqueued = 0;

  try {
    const subscriptions = await fetchActiveSubscriptions(cfg);

    for (const sub of subscriptions) {
      try {
        // 1. Fetch relevant news
        const items = await fetchRecentNews(cfg, {
          since,
          categories: sub.categories.length > 0 ? sub.categories : undefined,
          limit: sub.max_items * 3, // Fetch extra to allow curation
        });

        if (items.length === 0) {
          continue; // Nothing to report today
        }

        // 2. Assemble digest
        const digest = assembleDigest(items, { maxItemsPerCategory: sub.max_items });
        const markdown = buildDigestMarkdown(digest.title, digest.sections, {
          generatedAt: digest.generatedAt,
          totalItems: digest.totalItems,
        });

        // 3. Store digest
        if (!opts?.dryRun) {
          const stored = await storeDigest(cfg, {
            user_id: sub.user_id,
            type: 'daily',
            title: digest.title,
            content: markdown,
            sources: digest.sources,
            news_item_ids: items.map((i) => i.id),
            metrics: {
              lookbackHours: lookback,
              categoryCount: digest.sections.length,
              itemCount: digest.totalItems,
            },
          });

          digestsCreated++;

          // 4. Enqueue delivery jobs per channel
          for (const channel of sub.channels) {
            await insertQueueJob(
              cfg,
              'digest:deliver',
              {
                digestId: stored.id,
                userId: sub.user_id,
                channel,
                type: 'daily',
              },
              { priority: 1 }
            );
            jobsEnqueued++;
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Subscription ${sub.user_id}: ${msg}`);
      }
    }

    // Record aggregate metric
    await recordMetric(cfg, 'digests_generated', digestsCreated, 'daily');
    await recordMetric(cfg, 'delivery_jobs_enqueued', jobsEnqueued, 'daily');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`Pipeline error: ${msg}`);
  }

  return { digestsCreated, jobsEnqueued, errors };
}

/**
 * Generate a one-off event digest for a specific topic / keywords.
 */
export async function generateEventDigest(
  cfg: SupabaseConfig,
  params: {
    userId: string;
    title: string;
    keywords: string[];
    lookbackHours?: number;
    channels?: string[];
  }
): Promise<{ digestId?: string; error?: string }> {
  try {
    const lookback = params.lookbackHours ?? 72;
    const since = new Date(Date.now() - lookback * 60 * 60 * 1000).toISOString();

    // Search by title / summary containing keywords (simple filter)
    const allItems = await fetchRecentNews(cfg, { since, limit: 200 });
    const lowerKw = params.keywords.map((k) => k.toLowerCase());
    const filtered = allItems.filter((item) =>
      lowerKw.some((kw) =>
        item.title.toLowerCase().includes(kw) ||
        (item.summary && item.summary.toLowerCase().includes(kw)) ||
        item.tags.some((t) => t.toLowerCase().includes(kw))
      )
    );

    if (filtered.length === 0) {
      return { error: 'No matching items found for event digest' };
    }

    const digest = assembleDigest(filtered, { maxItemsPerCategory: 20 });
    const markdown = buildDigestMarkdown(params.title, digest.sections, {
      generatedAt: digest.generatedAt,
      totalItems: digest.totalItems,
    });

    const stored = await storeDigest(cfg, {
      user_id: params.userId,
      type: 'event',
      title: params.title,
      content: markdown,
      sources: digest.sources,
      news_item_ids: filtered.map((i) => i.id),
      metrics: { keywords: params.keywords, lookbackHours: lookback },
    });

    // Enqueue deliveries
    for (const channel of params.channels || ['email']) {
      await insertQueueJob(cfg, 'digest:deliver', {
        digestId: stored.id,
        userId: params.userId,
        channel,
        type: 'event',
      });
    }

    return { digestId: stored.id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
