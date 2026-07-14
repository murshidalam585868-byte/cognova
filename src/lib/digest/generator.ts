/**
 * Digest Generator — Next.js Library
 * ==================================
 * Server-side and client-side utilities for generating, formatting,
 * and rendering intelligence digests from the Shadow Brain database.
 *
 * Responsibilities:
 * - Fetch digest data from Supabase
 * - Generate formatted markdown / HTML / JSON
 * - Prepare digest payloads for email / Slack / webhook delivery
 * - Client-side rendering helpers for the dashboard
 */

import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import type { Digest } from '@/types';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DigestConfigSchema = z.object({
  supabaseUrl: z.string().url(),
  supabaseServiceKey: z.string().min(1),
  openaiApiKey: z.string().optional(),
  maxSummaryLength: z.number().int().default(300),
  defaultTimezone: z.string().default('UTC'),
});

export type DigestConfig = z.infer<typeof DigestConfigSchema>;

// ---------------------------------------------------------------------------
// Supabase client factory
// ---------------------------------------------------------------------------

function getSupabase(cfg: DigestConfig) {
  return createClient(cfg.supabaseUrl, cfg.supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

export async function fetchLatestDigests(
  cfg: DigestConfig,
  opts?: {
    userId?: string;
    type?: 'daily' | 'weekly' | 'event';
    limit?: number;
    offset?: number;
  }
): Promise<Digest[]> {
  const sb = getSupabase(cfg);
  let query = sb
    .from('digests')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(opts?.limit || 20);

  if (opts?.offset) {
    query = query.range(opts.offset, opts.offset + (opts.limit || 20) - 1);
  }
  if (opts?.userId) {
    query = query.eq('user_id', opts.userId);
  }
  if (opts?.type) {
    query = query.eq('type', opts.type);
  }

  const { data, error } = await query;
  if (error) throw new Error(`fetchLatestDigests failed: ${error.message}`);
  return (data || []) as Digest[];
}

export async function fetchDigestById(cfg: DigestConfig, digestId: string): Promise<Digest | null> {
  const sb = getSupabase(cfg);
  const { data, error } = await sb.from('digests').select('*').eq('id', digestId).single();
  if (error) {
    if (error.code === 'PGRST116') return null; // Not found
    throw new Error(`fetchDigestById failed: ${error.message}`);
  }
  return data as Digest;
}

export async function fetchDigestMetrics(
  cfg: DigestConfig,
  opts?: { days?: number; userId?: string }
): Promise<{
  totalDigests: number;
  dailyCount: number;
  weeklyCount: number;
  eventCount: number;
  sourcesUsed: string[];
  avgSourcesPerDigest: number;
}> {
  const sb = getSupabase(cfg);
  const days = opts?.days ?? 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  let query = sb.from('digests').select('*').gte('created_at', since);
  if (opts?.userId) query = query.eq('user_id', opts.userId);

  const { data, error } = await query;
  if (error) throw new Error(`fetchDigestMetrics failed: ${error.message}`);

  const digests = (data || []) as Digest[];
  const sourceSet = new Set<string>();
  let totalSources = 0;
  let dailyCount = 0;
  let weeklyCount = 0;
  let eventCount = 0;

  for (const d of digests) {
    if (d.type === 'daily') dailyCount++;
    if (d.type === 'weekly') weeklyCount++;
    if (d.type === 'event') eventCount++;
    for (const s of d.sources || []) sourceSet.add(s);
    totalSources += (d.sources || []).length;
  }

  return {
    totalDigests: digests.length,
    dailyCount,
    weeklyCount,
    eventCount,
    sourcesUsed: Array.from(sourceSet),
    avgSourcesPerDigest: digests.length > 0 ? Math.round((totalSources / digests.length) * 10) / 10 : 0,
  };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export interface FormattedDigest {
  id: string;
  title: string;
  type: string;
  html: string;
  plainText: string;
  sources: string[];
  createdAt: string;
  sections?: Array<{
    headline: string;
    items: Array<{ title: string; url: string; summary: string; source: string }>;
  }>;
}

/**
 * Convert markdown digest content to safe HTML.
 * Lightweight parser — for full safety, use a library like `marked` or `markdown-it`.
 */
export function markdownToHtml(markdown: string): string {
  let html = markdown
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
    .replace(/_(.*)_/gim, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/gim, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/^\s*-\s+(.*$)/gim, '<li>$1</li>')
    .replace(/<li>(.*)<\/li>/gims, '<ul><li>$1</li></ul>') // simplistic grouping
    .replace(/\n/gim, '<br>');

  // Deduplicate consecutive <br>
  html = html.replace(/(<br>\s*){2,}/gim, '<br><br>');
  return html;
}

/**
 * Strip markdown to plain text (for email previews / SMS).
 */
export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/^#+ (.*$)/gim, '$1')
    .replace(/\*\*(.*)\*\*/gim, '$1')
    .replace(/_(.*)_/gim, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/gim, '$1 ($2)')
    .replace(/^\s*-\s+(.*$)/gim, '• $1')
    .replace(/\n{2,}/gim, '\n\n')
    .trim();
}

/**
 * Format a digest for email delivery.
 */
export function formatForEmail(digest: Digest): {
  subject: string;
  htmlBody: string;
  textBody: string;
} {
  const html = markdownToHtml(digest.content);
  const text = markdownToPlainText(digest.content);

  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.6; color: #1a1a1a; max-width: 640px; margin: 0 auto; padding: 24px; }
    h1 { font-size: 22px; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; }
    h2 { font-size: 16px; color: #374151; margin-top: 24px; }
    a { color: #2563eb; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280; }
  </style>
</head>
<body>
  ${html}
  <div class="footer">
    Shadow Brain Chief of Staff — Automated Intelligence Briefing<br>
    Generated at ${new Date(digest.sentAt || digest.createdAt).toLocaleString()}
  </div>
</body>
</html>`;

  return {
    subject: digest.title,
    htmlBody,
    textBody: text,
  };
}

/**
 * Format a digest for Slack webhook delivery.
 */
export function formatForSlack(digest: Digest): {
  text: string;
  blocks: Array<Record<string, unknown>>;
} {
  const text = markdownToPlainText(digest.content);

  // Build Slack Block Kit blocks (simplified)
  const blocks: Array<Record<string, unknown>> = [
    {
      type: 'header',
      text: { type: 'plain_text', text: digest.title, emoji: true },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${digest.type.toUpperCase()} Digest* | ${new Date(digest.sentAt || digest.createdAt).toLocaleDateString()}`,
      },
    },
    {
      type: 'divider',
    },
  ];

  // Split content into sections (by ## headers)
  const sections = digest.content.split(/^## /m).filter(Boolean);
  for (const section of sections.slice(0, 5)) {
    const lines = section.split('\n').filter((l) => l.trim());
    const headline = lines[0]?.replace(/^##?\s*/, '').trim() || 'News';
    const body = lines.slice(1).join('\n').trim();

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${headline}*\n${markdownToPlainText(body).substring(0, 280)}...`,
      },
    });
  }

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Sources: ${digest.sources.slice(0, 5).join(', ')}${digest.sources.length > 5 ? '...' : ''}`,
      },
    ],
  });

  return { text, blocks };
}

// ---------------------------------------------------------------------------
// Digest builder (for programmatic creation from raw news)
// ---------------------------------------------------------------------------

export interface DigestBuilderInput {
  title: string;
  type: 'daily' | 'weekly' | 'event';
  sections: Array<{
    category: string;
    headline: string;
    items: Array<{
      title: string;
      url: string;
      summary: string;
      source: string;
      publishedAt: string;
    }>;
  }>;
  sources: string[];
  userId?: string;
}

export function buildDigestContent(input: DigestBuilderInput): string {
  const lines: string[] = [];
  lines.push(`# ${input.title}`);
  lines.push('');
  lines.push(`_${input.type.toUpperCase()} briefing — ${new Date().toLocaleDateString()}_`);
  lines.push('');

  for (const section of input.sections) {
    lines.push(`## ${section.headline}`);
    lines.push('');
    for (const item of section.items) {
      lines.push(`**${item.title}**  `);
      lines.push(`${item.summary}  `);
      lines.push(`_[${item.source}](${item.url})_  `);
      lines.push('');
    }
  }

  lines.push('---');
  lines.push('_Shadow Brain — Automated Intelligence Briefing_');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// API route helpers
// ---------------------------------------------------------------------------

/**
 * Generate a digest on-demand via API route.
 */
export async function generateOnDemandDigest(
  cfg: DigestConfig,
  params: {
    userId: string;
    title: string;
    keywords: string[];
    lookbackHours?: number;
  }
): Promise<{ digestId: string; preview: FormattedDigest }> {
  const sb = getSupabase(cfg);
  const lookback = params.lookbackHours ?? 24;
  const since = new Date(Date.now() - lookback * 60 * 60 * 1000).toISOString();

  // Fetch recent news matching keywords
  const { data: newsItems, error } = await sb
    .from('news_items')
    .select('id,title,url,summary,source_name,category,tags,published_at')
    .gte('fetched_at', since)
    .order('published_at', { ascending: false })
    .limit(200);

  if (error) throw new Error(`News fetch failed: ${error.message}`);

  const lowerKw = params.keywords.map((k) => k.toLowerCase());
  const filtered = (newsItems || []).filter((item: Record<string, unknown>) =>
    lowerKw.some((kw) =>
      String(item.title || '').toLowerCase().includes(kw) ||
      String(item.summary || '').toLowerCase().includes(kw) ||
      (Array.isArray(item.tags) && item.tags.some((t: string) => t.toLowerCase().includes(kw)))
    )
  );

  // Group by category
  const byCategory = new Map<string, typeof filtered>();
  for (const item of filtered) {
    const cat = String(item.category || 'general');
    const list = byCategory.get(cat) || [];
    list.push(item);
    byCategory.set(cat, list);
  }

  const sections = Array.from(byCategory.entries()).map(([category, items]) => ({
    category,
    headline: `${category.charAt(0).toUpperCase() + category.slice(1)} Brief`,
    items: items.slice(0, 10).map((i) => ({
      title: String(i.title),
      url: String(i.url),
      summary: String(i.summary || ''),
      source: String(i.source_name || 'Unknown'),
      publishedAt: String(i.published_at),
    })),
  }));

  const content = buildDigestContent({
    title: params.title,
    type: 'event',
    sections,
    sources: Array.from(new Set(filtered.map((i) => String(i.source_name || 'Unknown')))),
    userId: params.userId,
  });

  // Store digest
  const { data: inserted, error: insertError } = await sb
    .from('digests')
    .insert({
      user_id: params.userId,
      type: 'event',
      title: params.title,
      content,
      sources: Array.from(new Set(filtered.map((i) => String(i.source_name || 'Unknown')))),
      news_item_ids: filtered.map((i) => String(i.id)),
    })
    .select('id')
    .single();

  if (insertError) throw new Error(`Digest insert failed: ${insertError.message}`);

  const digestId = (inserted as Record<string, string>).id;

  return {
    digestId,
    preview: {
      id: digestId,
      title: params.title,
      type: 'event',
      html: markdownToHtml(content),
      plainText: markdownToPlainText(content),
      sources: Array.from(new Set(filtered.map((i) => String(i.source_name || 'Unknown')))),
      createdAt: new Date().toISOString(),
      sections,
    },
  };
}
