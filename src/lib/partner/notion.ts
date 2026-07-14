/**
 * Shadow Brain — Phase 4: AI Business Partner
 * Notion API Integration
 *
 * Connects to Notion workspaces for:
 * - Reading/writing pages (memos, reports, meeting notes)
 * - Querying databases (projects, tasks, OKRs, experiments)
 * - Creating structured content blocks
 *
 * Uses the Notion API (official JS client) with typed wrappers.
 */

import { z } from 'zod';
import { Client as NotionClient } from '@notionhq/client';
import { logger } from '@/lib/logger';

// ── Zod Schemas ────────────────────────────────────────────────────────────

export const NotionPageSchema = z.object({
  id: z.string(),
  url: z.string().url(),
  title: z.string(),
  createdTime: z.string(),
  lastEditedTime: z.string(),
  properties: z.record(z.unknown()).optional(),
});
export type NotionPage = z.infer<typeof NotionPageSchema>;

export const NotionDatabaseSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string().url(),
  properties: z.record(z.unknown()),
});
export type NotionDatabase = z.infer<typeof NotionDatabaseSchema>;

export const NotionQueryFilterSchema = z.record(z.unknown()).optional();
export type NotionQueryFilter = z.infer<typeof NotionQueryFilterSchema>;

export const CreatePageRequestSchema = z.object({
  parentDatabaseId: z.string().optional(),
  parentPageId: z.string().optional(),
  title: z.string().min(1),
  properties: z.record(z.unknown()).optional(),
  children: z.array(z.record(z.unknown())).optional(), // Block objects
  icon: z.string().optional(), // Emoji or external URL
});
export type CreatePageRequest = z.infer<typeof CreatePageRequestSchema>;

export const UpdatePageRequestSchema = z.object({
  pageId: z.string(),
  properties: z.record(z.unknown()),
  archived: z.boolean().optional(),
});
export type UpdatePageRequest = z.infer<typeof UpdatePageRequestSchema>;

// ── Client ─────────────────────────────────────────────────────────────────

let _notion: NotionClient | null = null;

function getNotionClient(): NotionClient {
  if (_notion) return _notion;

  const token = process.env.NOTION_TOKEN;
  if (!token) {
    throw new Error('Missing NOTION_TOKEN env var. Create a Notion integration at https://www.notion.so/my-integrations and share pages/databases with it.');
  }

  _notion = new NotionClient({ auth: token });
  return _notion;
}

/** Reset cached client (for credential rotation or testing). */
export function resetNotionClient(): void {
  _notion = null;
}

// ── Page Operations ────────────────────────────────────────────────────────

/**
 * Retrieve a page by ID and normalize to our typed shape.
 */
export async function getPage(pageId: string): Promise<NotionPage> {
  const notion = getNotionClient();
  const page = await notion.pages.retrieve({ page_id: pageId });

  const title = extractTitle(page);
  return NotionPageSchema.parse({
    id: page.id,
    url: (page as any).url ?? `https://www.notion.so/${page.id.replace(/-/g, '')}`,
    title,
    createdTime: (page as any).created_time,
    lastEditedTime: (page as any).last_edited_time,
    properties: (page as any).properties,
  });
}

/**
 * Create a new page in a database or as a child of another page.
 */
export async function createPage(req: CreatePageRequest): Promise<NotionPage> {
  const validated = CreatePageRequestSchema.parse(req);
  const notion = getNotionClient();

  if (!validated.parentDatabaseId && !validated.parentPageId) {
    throw new Error('Either parentDatabaseId or parentPageId is required.');
  }

  const parent: any = validated.parentDatabaseId
    ? { database_id: validated.parentDatabaseId }
    : { page_id: validated.parentPageId };

  const properties: any = { ...validated.properties };

  // Auto-inject title if parent is a database with a 'title' or 'Name' property
  if (validated.parentDatabaseId) {
    const db = await notion.databases.retrieve({ database_id: validated.parentDatabaseId });
    const titleProp = Object.entries(db.properties).find(([, v]) => v.type === 'title');
    if (titleProp) {
      properties[titleProp[0]] = {
        title: [{ text: { content: validated.title } }],
      };
    } else {
      // Fallback for page-type parents
      properties.title = { title: [{ text: { content: validated.title } }] };
    }
  } else {
    properties.title = { title: [{ text: { content: validated.title } }] };
  }

  const page = await notion.pages.create({
    parent,
    properties,
    children: validated.children as any[],
    icon: validated.icon ? { emoji: validated.icon } : undefined,
  });

  logger.info('[notion] createPage', { pageId: page.id, title: validated.title });

  return NotionPageSchema.parse({
    id: page.id,
    url: (page as any).url,
    title: validated.title,
    createdTime: (page as any).created_time,
    lastEditedTime: (page as any).last_edited_time,
    properties: (page as any).properties,
  });
}

/**
 * Update a page's properties (or archive it).
 */
export async function updatePage(req: UpdatePageRequest): Promise<NotionPage> {
  const validated = UpdatePageRequestSchema.parse(req);
  const notion = getNotionClient();

  const page = await notion.pages.update({
    page_id: validated.pageId,
    properties: validated.properties,
    archived: validated.archived,
  });

  logger.info('[notion] updatePage', { pageId: validated.pageId });

  return NotionPageSchema.parse({
    id: page.id,
    url: (page as any).url,
    title: extractTitle(page),
    createdTime: (page as any).created_time,
    lastEditedTime: (page as any).last_edited_time,
    properties: (page as any).properties,
  });
}

// ── Database Operations ────────────────────────────────────────────────────

/**
 * List all databases accessible to the integration (paginated).
 */
export async function listDatabases(): Promise<NotionDatabase[]> {
  const notion = getNotionClient();
  const results: NotionDatabase[] = [];
  let cursor: string | undefined;

  do {
    const res: any = await notion.search({
      filter: { value: 'database', property: 'object' },
      start_cursor: cursor,
      page_size: 100,
    });

    for (const db of res.results ?? []) {
      results.push(NotionDatabaseSchema.parse({
        id: db.id,
        title: db.title?.map((t: any) => t.plain_text).join('') ?? 'Untitled',
        url: db.url,
        properties: db.properties,
      }));
    }

    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);

  logger.info('[notion] listDatabases', { count: results.length });
  return results;
}

/**
 * Query a database with optional filters, sorts, and pagination.
 */
export async function queryDatabase(
  databaseId: string,
  options?: {
    filter?: NotionQueryFilter;
    sorts?: Array<Record<string, unknown>>;
    pageSize?: number;
    startCursor?: string;
  }
): Promise<{ pages: NotionPage[]; hasMore: boolean; nextCursor?: string }> {
  const notion = getNotionClient();

  const res: any = await notion.databases.query({
    database_id: databaseId,
    filter: options?.filter as any,
    sorts: options?.sorts as any,
    page_size: options?.pageSize ?? 100,
    start_cursor: options?.startCursor,
  });

  const pages = (res.results ?? []).map((page: any) =>
    NotionPageSchema.parse({
      id: page.id,
      url: page.url,
      title: extractTitle(page),
      createdTime: page.created_time,
      lastEditedTime: page.last_edited_time,
      properties: page.properties,
    })
  );

  return {
    pages,
    hasMore: res.has_more ?? false,
    nextCursor: res.next_cursor ?? undefined,
  };
}

// ── Block Operations ───────────────────────────────────────────────────────

/**
 * Append rich content blocks to a page.
 */
export async function appendBlocks(pageId: string, blocks: Array<Record<string, unknown>>): Promise<void> {
  const notion = getNotionClient();

  await notion.blocks.children.append({
    block_id: pageId,
    children: blocks as any[],
  });

  logger.info('[notion] appendBlocks', { pageId, count: blocks.length });
}

/**
 * Build common block types for memos / reports.
 */
export function buildBlocks() {
  return {
    heading1: (text: string) => ({ object: 'block', type: 'heading_1', heading_1: { rich_text: [{ type: 'text', text: { content: text } }] } }),
    heading2: (text: string) => ({ object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: text } }] } }),
    heading3: (text: string) => ({ object: 'block', type: 'heading_3', heading_3: { rich_text: [{ type: 'text', text: { content: text } }] } }),
    paragraph: (text: string) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: text } }] } }),
    bulletedListItem: (text: string) => ({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', text: { content: text } }] } }),
    numberedListItem: (text: string) => ({ object: 'block', type: 'numbered_list_item', numbered_list_item: { rich_text: [{ type: 'text', text: { content: text } }] } }),
    toDo: (text: string, checked = false) => ({ object: 'block', type: 'to_do', to_do: { rich_text: [{ type: 'text', text: { content: text } }], checked } }),
    divider: () => ({ object: 'block', type: 'divider', divider: {} }),
    code: (text: string, language = 'typescript') => ({ object: 'block', type: 'code', code: { rich_text: [{ type: 'text', text: { content: text } }], language } }),
    quote: (text: string) => ({ object: 'block', type: 'quote', quote: { rich_text: [{ type: 'text', text: { content: text } }] } }),
    callout: (text: string, icon?: string) => ({ object: 'block', type: 'callout', callout: { rich_text: [{ type: 'text', text: { content: text } }], icon: icon ? { emoji: icon } : { emoji: '💡' } } }),
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function extractTitle(page: any): string {
  // Database pages have a title property; regular pages have a top-level title
  const props = page.properties ?? {};
  const titleProp = Object.entries(props).find(([, v]: [string, any]) => v.type === 'title');
  if (titleProp) {
    const richText = (titleProp[1] as any).title ?? [];
    return richText.map((t: any) => t.plain_text ?? t.text?.content ?? '').join('');
  }
  // Fallback for page object
  return 'Untitled';
}

/**
 * Export a reasoning memo to a Notion page.
 */
export async function exportMemoToNotion(
  parentDatabaseId: string,
  title: string,
  memoMarkdown: string
): Promise<NotionPage> {
  const blocks = buildBlocks();
  const lines = memoMarkdown.split('\n');
  const children: Array<Record<string, unknown>> = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('# ')) {
      children.push(blocks.heading1(trimmed.replace('# ', '')));
    } else if (trimmed.startsWith('## ')) {
      children.push(blocks.heading2(trimmed.replace('## ', '')));
    } else if (trimmed.startsWith('### ')) {
      children.push(blocks.heading3(trimmed.replace('### ', '')));
    } else if (trimmed.startsWith('- ')) {
      children.push(blocks.bulletedListItem(trimmed.replace('- ', '')));
    } else if (trimmed.startsWith('- [ ] ')) {
      children.push(blocks.toDo(trimmed.replace('- [ ] ', ''), false));
    } else if (trimmed.startsWith('- [x] ')) {
      children.push(blocks.toDo(trimmed.replace('- [x] ', ''), true));
    } else if (trimmed.startsWith('> ')) {
      children.push(blocks.quote(trimmed.replace('> ', '')));
    } else if (trimmed.startsWith('```')) {
      // Skip code fences — simplistic; real impl would capture multi-line
      continue;
    } else {
      children.push(blocks.paragraph(trimmed));
    }
  }

  return createPage({
    parentDatabaseId,
    title,
    children,
    icon: '🧠',
  });
}
