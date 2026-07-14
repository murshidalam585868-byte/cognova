/**
 * RSS & News Ingestion Module
 * ===========================
 * Fetches, parses, deduplicates, and stores RSS feed items into the
 * Supabase `news_items` table. Designed to run inside a Cloudflare Worker.
 *
 * Features:
 * - HTTP conditional fetching (ETag / Last-Modified) to minimize bandwidth
 * - XML-to-JSON parsing without heavy Node dependencies
 * - Content hash deduplication
 * - Category tagging from source registry
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const RssItemSchema = z.object({
  title: z.string().min(1),
  link: z.string().url(),
  description: z.string().optional(),
  pubDate: z.string().optional(),
  author: z.string().optional(),
  guid: z.string().optional(),
  categories: z.array(z.string()).default([]),
});

export type RssItem = z.infer<typeof RssItemSchema>;

export const FeedSourceSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string(),
  url: z.string().url(),
  category: z.string().default('general'),
  is_active: z.boolean().default(true),
  last_etag: z.string().optional(),
  last_modified: z.string().optional(),
});

export type FeedSource = z.infer<typeof FeedSourceSchema>;

// ---------------------------------------------------------------------------
// XML Parser (lightweight — no external deps)
// ---------------------------------------------------------------------------

function getTextContent(el: Element | null): string {
  if (!el) return '';
  return el.textContent?.trim() || '';
}

function extractItems(xmlText: string): RssItem[] {
  const items: RssItem[] = [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');

  // Handle RSS 2.0 <item> elements
  const rssItems = doc.querySelectorAll('item');
  for (const item of Array.from(rssItems)) {
    const title = getTextContent(item.querySelector('title'));
    const link = getTextContent(item.querySelector('link'));
    const description = getTextContent(item.querySelector('description'));
    const pubDate = getTextContent(item.querySelector('pubDate'));
    const author = getTextContent(item.querySelector('author')) || getTextContent(item.querySelector('creator'));
    const guid = getTextContent(item.querySelector('guid'));
    const categories = Array.from(item.querySelectorAll('category')).map((c) => getTextContent(c));

    if (!title || !link) continue;

    const parsed: RssItem = {
      title,
      link,
      description: description || undefined,
      pubDate: pubDate || undefined,
      author: author || undefined,
      guid: guid || undefined,
      categories: categories.length > 0 ? categories : [],
    };

    const validation = RssItemSchema.safeParse(parsed);
    if (validation.success) {
      items.push(validation.data);
    }
  }

  // Handle Atom <entry> elements (fallback)
  if (items.length === 0) {
    const atomEntries = doc.querySelectorAll('entry');
    for (const entry of Array.from(atomEntries)) {
      const title = getTextContent(entry.querySelector('title'));
      const linkEl = entry.querySelector('link');
      const link = linkEl?.getAttribute('href') || '';
      const summary = getTextContent(entry.querySelector('summary')) || getTextContent(entry.querySelector('content'));
      const updated = getTextContent(entry.querySelector('updated')) || getTextContent(entry.querySelector('published'));
      const author = getTextContent(entry.querySelector('author > name'));
      const id = getTextContent(entry.querySelector('id'));
      const categories = Array.from(entry.querySelectorAll('category')).map((c) => c.getAttribute('term') || '');

      if (!title || !link) continue;

      const parsed: RssItem = {
        title,
        link,
        description: summary || undefined,
        pubDate: updated || undefined,
        author: author || undefined,
        guid: id || undefined,
        categories: categories.length > 0 ? categories : [],
      };

      const validation = RssItemSchema.safeParse(parsed);
      if (validation.success) {
        items.push(validation.data);
      }
    }
  }

  return items;
}

// ---------------------------------------------------------------------------
// Fetch with conditional headers
// ---------------------------------------------------------------------------

interface FetchFeedResult {
  items: RssItem[];
  etag?: string;
  lastModified?: string;
  status: number;
  notModified: boolean;
}

export async function fetchFeed(
  source: FeedSource,
  requestInit?: RequestInit
): Promise<FetchFeedResult> {
  const headers = new Headers();
  if (source.last_etag) headers.set('If-None-Match', source.last_etag);
  if (source.last_modified) headers.set('If-Modified-Since', source.last_modified);

  const res = await fetch(source.url, {
    ...requestInit,
    headers,
  });

  if (res.status === 304) {
    return {
      items: [],
      status: 304,
      notModified: true,
    };
  }

  if (!res.ok) {
    throw new Error(`Feed fetch failed: ${source.url} → ${res.status} ${res.statusText}`);
  }

  const xmlText = await res.text();
  const items = extractItems(xmlText);

  return {
    items,
    etag: res.headers.get('ETag') || undefined,
    lastModified: res.headers.get('Last-Modified') || undefined,
    status: res.status,
    notModified: false,
  };
}

// ---------------------------------------------------------------------------
// Supabase persistence helpers (REST API via fetch)
// ---------------------------------------------------------------------------

export interface SupabaseConfig {
  url: string;
  serviceKey: string;
}

function supabaseHeaders(cfg: SupabaseConfig): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'apikey': cfg.serviceKey,
    'Authorization': `Bearer ${cfg.serviceKey}`,
    'Prefer': 'resolution=merge-duplicates', // Upsert behavior
  };
}

export async function fetchActiveSources(cfg: SupabaseConfig): Promise<FeedSource[]> {
  const url = `${cfg.url}/rest/v1/rss_sources?select=*&is_active=eq.true&order=created_at.asc`;
  const res = await fetch(url, { headers: supabaseHeaders(cfg) });
  if (!res.ok) throw new Error(`Failed to fetch sources: ${res.status}`);
  const data = await res.json() as unknown[];
  return data.map((d) => FeedSourceSchema.parse(d));
}

export async function updateSourceHeaders(
  cfg: SupabaseConfig,
  sourceId: string,
  etag?: string,
  lastModified?: string
): Promise<void> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (etag) payload.last_etag = etag;
  if (lastModified) payload.last_modified = lastModified;
  payload.last_fetched_at = new Date().toISOString();

  const res = await fetch(`${cfg.url}/rest/v1/rss_sources?id=eq.${sourceId}`, {
    method: 'PATCH',
    headers: supabaseHeaders(cfg),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Failed to update source headers: ${res.status}`);
}

export async function insertNewsItems(
  cfg: SupabaseConfig,
  items: Array<{
    title: string;
    url: string;
    source_id?: string;
    source_name?: string;
    summary?: string;
    author?: string;
    category: string;
    tags: string[];
    published_at?: string;
  }>
): Promise<{ inserted: number; errors: string[] }> {
  const errors: string[] = [];
  let inserted = 0;

  // Batch insert in chunks of 100 (Supabase PostgREST limit)
  const CHUNK = 100;
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    const res = await fetch(`${cfg.url}/rest/v1/news_items`, {
      method: 'POST',
      headers: {
        ...supabaseHeaders(cfg),
        'Prefer': 'resolution=ignore-duplicates', // Skip on URL conflict
      },
      body: JSON.stringify(chunk),
    });

    if (!res.ok) {
      const text = await res.text();
      errors.push(`Batch ${i / CHUNK + 1}: ${text}`);
    } else {
      // Supabase returns inserted rows; count is approximate due to dedup
      inserted += chunk.length;
    }
  }

  return { inserted, errors };
}

// ---------------------------------------------------------------------------
// Main ingestion pipeline
// ---------------------------------------------------------------------------

export interface IngestResult {
  sourceId: string;
  sourceName: string;
  fetched: number;
  inserted: number;
  errors: string[];
  notModified: boolean;
}

export async function ingestAllFeeds(
  cfg: SupabaseConfig,
  opts?: { requestInit?: RequestInit; maxItemsPerSource?: number }
): Promise<IngestResult[]> {
  const sources = await fetchActiveSources(cfg);
  const results: IngestResult[] = [];

  for (const source of sources) {
    try {
      const feed = await fetchFeed(source, opts?.requestInit);

      if (feed.notModified) {
        results.push({
          sourceId: source.id || 'unknown',
          sourceName: source.name,
          fetched: 0,
          inserted: 0,
          errors: [],
          notModified: true,
        });
        continue;
      }

      // Limit items if configured
      let items = feed.items;
      if (opts?.maxItemsPerSource && items.length > opts.maxItemsPerSource) {
        items = items.slice(0, opts.maxItemsPerSource);
      }

      // Transform to DB rows
      const rows = items.map((item) => ({
        title: item.title,
        url: item.link,
        source_id: source.id,
        source_name: source.name,
        summary: item.description || '',
        author: item.author || '',
        category: source.category,
        tags: item.categories,
        published_at: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
      }));

      const { inserted, errors } = await insertNewsItems(cfg, rows);

      // Update source headers for conditional fetching next time
      if (source.id) {
        await updateSourceHeaders(cfg, source.id, feed.etag, feed.lastModified);
      }

      results.push({
        sourceId: source.id || 'unknown',
        sourceName: source.name,
        fetched: items.length,
        inserted,
        errors,
        notModified: false,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        sourceId: source.id || 'unknown',
        sourceName: source.name,
        fetched: 0,
        inserted: 0,
        errors: [message],
        notModified: false,
      });
    }
  }

  return results;
}
