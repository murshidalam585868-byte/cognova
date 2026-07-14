/**
 * src/lib/learning/memory-consolidation.ts
 * Continuous Learning — Memory Consolidation Engine
 *
 * Compresses old conversations into long-term memory summaries using LLM-based
 * summarization. Stores summaries in Supabase and Pinecone for RAG retrieval.
 * Supports configurable retention policies, incremental consolidation, and
 * deduplication of existing summaries.
 */

import { z } from 'zod';
import { getSupabaseClient } from '@/lib/db/supabase';
import { logger } from '@/lib/logger';
import { loadConfig } from '@/lib/config';
import { embedTexts, upsertVectors, retrieveRelevantTexts } from '@/lib/vector/pinecone';
import type { Conversation, Message, MemorySummary } from '@/types';

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

export const ConsolidationConfigSchema = z.object({
  userId: z.string().uuid(),
  maxAgeDays: z.number().int().min(1).max(365).default(30),
  minMessages: z.number().int().min(2).max(1000).default(6),
  maxConversationsPerBatch: z.number().int().min(1).max(50).default(10),
  namespace: z.string().default('memory-summaries'),
  dryRun: z.boolean().default(false),
});
export type ConsolidationConfig = z.infer<typeof ConsolidationConfigSchema>;

export const ConsolidationResultSchema = z.object({
  processedConversations: z.number().int(),
  summariesCreated: z.number().int(),
  summariesUpdated: z.number().int(),
  errors: z.array(z.string()),
  dryRun: z.boolean(),
});
export type ConsolidationResult = z.infer<typeof ConsolidationResultSchema>;

// ---------------------------------------------------------------------------
// Core Operations
// ---------------------------------------------------------------------------

/**
 * Identify conversations that are candidates for consolidation.
 * Filters by age, message count, and whether already consolidated.
 */
export async function getConversationsForConsolidation(
  config: ConsolidationConfig
): Promise<Conversation[]> {
  const validated = ConsolidationConfigSchema.parse(config);
  const sb = getSupabaseClient();

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - validated.maxAgeDays);

  // Get conversation IDs already consolidated
  const { data: existingSummaries, error: summaryError } = await sb
    .from('memory_summaries')
    .select('conversation_ids')
    .eq('user_id', validated.userId);

  if (summaryError) {
    logger.error('Failed to fetch existing summaries', { error: summaryError });
    throw new Error(`DB error: ${summaryError.message}`);
  }

  const consolidatedIds = new Set<string>();
  for (const row of existingSummaries ?? []) {
    const ids = (row.conversation_ids as string[]) ?? [];
    ids.forEach((id) => consolidatedIds.add(id));
  }

  // Fetch conversations older than cutoff with sufficient messages
  const { data: convs, error: convError } = await sb
    .from('conversations')
    .select('*, messages(count)')
    .eq('user_id', validated.userId)
    .lt('updated_at', cutoff.toISOString())
    .order('updated_at', { ascending: false })
    .limit(validated.maxConversationsPerBatch * 2);

  if (convError) {
    logger.error('Failed to fetch conversations', { error: convError });
    throw new Error(`DB error: ${convError.message}`);
  }

  const candidates: Conversation[] = [];
  for (const raw of convs ?? []) {
    if (consolidatedIds.has(String(raw.id))) continue;
    // messages count from the join
    const msgCount = Number(raw.messages?.[0]?.count ?? raw.messages ?? 0);
    if (msgCount >= validated.minMessages) {
      candidates.push(await hydrateConversation(String(raw.id)));
    }
    if (candidates.length >= validated.maxConversationsPerBatch) break;
  }

  return candidates;
}

/**
 * Consolidate a single conversation into a memory summary.
 */
export async function consolidateConversation(
  conversation: Conversation,
  opts?: { namespace?: string; dryRun?: boolean }
): Promise<MemorySummary> {
  const sb = getSupabaseClient();
  const namespace = opts?.namespace ?? 'memory-summaries';

  // Generate summary via LLM
  const summaryText = await generateConversationSummary(conversation);
  const keyFacts = await extractKeyFacts(conversation);
  const topics = await extractTopics(conversation);

  const memorySummary: MemorySummary = {
    id: crypto.randomUUID(),
    userId: conversation.userId,
    conversationIds: [conversation.id],
    summary: summaryText,
    keyFacts,
    topics,
    namespace,
    metadata: {
      messageCount: conversation.messages.length,
      title: conversation.title,
      consolidatedAt: new Date().toISOString(),
    },
    createdAt: new Date().toISOString(),
    expiresAt: undefined,
  };

  if (opts?.dryRun) {
    return memorySummary;
  }

  // Embed and store in vector DB
  try {
    const embeddingTexts = [
      memorySummary.summary,
      ...memorySummary.keyFacts,
      `Topics: ${memorySummary.topics.join(', ')}`,
    ];
    const embeddings = await embedTexts(embeddingTexts);
    await upsertVectors(
      embeddings.map((values, i) => ({
        id: `${memorySummary.id}-${i}`,
        values,
        metadata: {
          summaryId: memorySummary.id,
          userId: memorySummary.userId,
          type: i === 0 ? 'summary' : i <= memorySummary.keyFacts.length ? 'fact' : 'topics',
          text: embeddingTexts[i],
          createdAt: memorySummary.createdAt,
        },
      })),
      `${namespace}-${memorySummary.userId}`
    );
  } catch (vectorErr) {
    logger.warn('Failed to index memory summary in vector store', {
      error: vectorErr instanceof Error ? vectorErr.message : String(vectorErr),
      summaryId: memorySummary.id,
    });
  }

  // Persist to Supabase
  const { data, error } = await sb
    .from('memory_summaries')
    .insert({
      id: memorySummary.id,
      user_id: memorySummary.userId,
      conversation_ids: memorySummary.conversationIds,
      summary: memorySummary.summary,
      key_facts: memorySummary.keyFacts,
      topics: memorySummary.topics,
      namespace: memorySummary.namespace,
      metadata: memorySummary.metadata,
      created_at: memorySummary.createdAt,
      expires_at: memorySummary.expiresAt ?? null,
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to save memory summary', { error, summaryId: memorySummary.id });
    throw new Error(`DB error: ${error.message}`);
  }

  logger.info('Conversation consolidated into memory', {
    summaryId: memorySummary.id,
    conversationId: conversation.id,
    factCount: keyFacts.length,
  });

  return mapMemorySummary(data);
}

/**
 * Batch consolidation runner.
 */
export async function runConsolidation(config: ConsolidationConfig): Promise<ConsolidationResult> {
  const validated = ConsolidationConfigSchema.parse(config);
  const result: ConsolidationResult = {
    processedConversations: 0,
    summariesCreated: 0,
    summariesUpdated: 0,
    errors: [],
    dryRun: validated.dryRun,
  };

  try {
    const candidates = await getConversationsForConsolidation(validated);

    for (const conversation of candidates) {
      try {
        await consolidateConversation(conversation, {
          namespace: validated.namespace,
          dryRun: validated.dryRun,
        });
        result.processedConversations += 1;
        result.summariesCreated += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('Failed to consolidate conversation', { error: msg, conversationId: conversation.id });
        result.errors.push(`${conversation.id}: ${msg}`);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`Batch error: ${msg}`);
  }

  logger.info('Consolidation batch completed', {
    userId: validated.userId,
    processed: result.processedConversations,
    created: result.summariesCreated,
    errors: result.errors.length,
  });

  return result;
}

/**
 * Retrieve consolidated memories for a user.
 */
export async function retrieveConsolidatedMemories(
  userId: string,
  opts?: { namespace?: string; limit?: number; query?: string }
): Promise<MemorySummary[]> {
  const sb = getSupabaseClient();
  const namespace = opts?.namespace ?? 'memory-summaries';

  // If a query is provided, use vector search
  if (opts?.query) {
    try {
      const relevant = await retrieveRelevantTexts(
        opts.query,
        `${namespace}-${userId}`,
        opts.limit ?? 5
      );
      const summaryIds = new Set(
        relevant.map((r) => String(r.metadata?.summaryId ?? '')).filter(Boolean)
      );
      if (summaryIds.size > 0) {
        const { data, error } = await sb
          .from('memory_summaries')
          .select('*')
          .eq('user_id', userId)
          .in('id', [...summaryIds]);

        if (!error && data) {
          return data.map(mapMemorySummary);
        }
      }
    } catch (err) {
      logger.warn('Vector retrieval failed, falling back to DB', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Fallback: direct DB query
  let query = sb
    .from('memory_summaries')
    .select('*')
    .eq('user_id', userId)
    .eq('namespace', namespace)
    .order('created_at', { ascending: false });

  if (opts?.limit) query = query.limit(opts.limit);

  const { data, error } = await query;

  if (error) {
    logger.error('Failed to retrieve consolidated memories', { error, userId });
    throw new Error(`DB error: ${error.message}`);
  }

  return (data ?? []).map(mapMemorySummary);
}

/**
 * Compress multiple memory summaries into a higher-level summary (recursive compression).
 */
export async function compressMemories(
  summaries: MemorySummary[],
  userId: string
): Promise<MemorySummary> {
  if (summaries.length === 0) {
    throw new Error('Cannot compress empty memory list');
  }
  if (summaries.length === 1) {
    return summaries[0];
  }

  const combinedText = summaries
    .map((s) => `Summary: ${s.summary}\nKey Facts: ${s.keyFacts.join('; ')}\nTopics: ${s.topics.join(', ')}`)
    .join('\n\n---\n\n');

  const compressed = await generateCompressedSummary(combinedText);
  const allTopics = [...new Set(summaries.flatMap((s) => s.topics))];
  const allFacts = [...new Set(summaries.flatMap((s) => s.keyFacts))];

  const compressedMemory: MemorySummary = {
    id: crypto.randomUUID(),
    userId,
    conversationIds: summaries.flatMap((s) => s.conversationIds),
    summary: compressed.summary,
    keyFacts: compressed.keyFacts,
    topics: allTopics.slice(0, 20),
    namespace: 'memory-summaries-compressed',
    metadata: {
      compressedFrom: summaries.map((s) => s.id),
      originalCount: summaries.length,
      compressedAt: new Date().toISOString(),
    },
    createdAt: new Date().toISOString(),
  };

  // Store compressed memory
  const sb = getSupabaseClient();
  try {
    await sb.from('memory_summaries').insert({
      id: compressedMemory.id,
      user_id: compressedMemory.userId,
      conversation_ids: compressedMemory.conversationIds,
      summary: compressedMemory.summary,
      key_facts: compressedMemory.keyFacts,
      topics: compressedMemory.topics,
      namespace: compressedMemory.namespace,
      metadata: compressedMemory.metadata,
      created_at: compressedMemory.createdAt,
    });

    // Index in vector store
    const embeddings = await embedTexts([compressedMemory.summary, ...compressedMemory.keyFacts]);
    await upsertVectors(
      embeddings.map((values, i) => ({
        id: `${compressedMemory.id}-${i}`,
        values,
        metadata: {
          summaryId: compressedMemory.id,
          userId,
          type: i === 0 ? 'summary' : 'fact',
          text: i === 0 ? compressedMemory.summary : compressedMemory.keyFacts[i - 1],
          createdAt: compressedMemory.createdAt,
        },
      })),
      `${compressedMemory.namespace}-${userId}`
    );
  } catch (err) {
    logger.error('Failed to persist compressed memory', {
      error: err instanceof Error ? err.message : String(err),
      memoryId: compressedMemory.id,
    });
  }

  return compressedMemory;
}

/**
 * Delete a memory summary and its vector embeddings.
 */
export async function deleteMemorySummary(summaryId: string): Promise<void> {
  const sb = getSupabaseClient();

  const { error } = await sb.from('memory_summaries').delete().eq('id', summaryId);
  if (error) {
    logger.error('Failed to delete memory summary', { error, summaryId });
    throw new Error(`DB error: ${error.message}`);
  }

  // Note: vector deletion would require tracking all vector IDs per summary
  logger.info('Memory summary deleted', { summaryId });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function hydrateConversation(conversationId: string): Promise<Conversation> {
  const sb = getSupabaseClient();

  const [{ data: convRow, error: convErr }, { data: msgRows, error: msgErr }] = await Promise.all([
    sb.from('conversations').select('*').eq('id', conversationId).single(),
    sb.from('messages').select('*').eq('conversation_id', conversationId).order('created_at', { ascending: true }),
  ]);

  if (convErr) throw new Error(`Failed to load conversation: ${convErr.message}`);
  if (msgErr) throw new Error(`Failed to load messages: ${msgErr.message}`);

  const messages: Message[] = (msgRows ?? []).map((m) => ({
    id: String(m.id),
    role: m.role as Message['role'],
    content: String(m.content),
    metadata: (m.metadata as Record<string, unknown>) ?? {},
    createdAt: String(m.created_at),
  }));

  return {
    id: String(convRow.id),
    userId: String(convRow.user_id),
    title: String(convRow.title),
    messages,
    createdAt: String(convRow.created_at),
    updatedAt: String(convRow.updated_at),
  };
}

async function generateConversationSummary(conversation: Conversation): Promise<string> {
  const config = loadConfig();
  const transcript = conversation.messages
    .map((m) => `${m.role.toUpperCase()}: ${m.content.slice(0, 500)}`)
    .join('\n');

  const prompt = `Summarize the following conversation in 2-4 sentences. Capture the main topics discussed, key decisions made, and any important facts to remember for future interactions. Be concise but comprehensive.\n\n${transcript}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a memory consolidation assistant. Summarize conversations for long-term retrieval.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 300,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const json = await response.json();
    const summary = json.choices?.[0]?.message?.content?.trim();
    if (summary) return summary;
  } catch (err) {
    logger.warn('LLM summary generation failed, using fallback', {
      error: err instanceof Error ? err.message : String(err),
      conversationId: conversation.id,
    });
  }

  // Fallback: extract first user query + last assistant response
  const firstUser = conversation.messages.find((m) => m.role === 'user')?.content.slice(0, 200);
  const lastAssistant = conversation.messages.filter((m) => m.role === 'assistant').pop()?.content.slice(0, 200);
  return `Conversation about: ${firstUser ?? 'general topics'}. Last response: ${lastAssistant ?? 'N/A'}.`;
}

async function extractKeyFacts(conversation: Conversation): Promise<string[]> {
  const config = loadConfig();
  const transcript = conversation.messages
    .slice(-10)
    .map((m) => `${m.role.toUpperCase()}: ${m.content.slice(0, 400)}`)
    .join('\n');

  const prompt = `Extract 3-5 key facts, decisions, or pieces of information from this conversation that should be remembered long-term. Return ONLY a JSON array of strings.\n\n${transcript}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You extract key facts from conversations. Return only a JSON array of strings.' },
          { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_tokens: 400,
      }),
    });

    if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`);
    const json = await response.json();
    const raw = json.choices?.[0]?.message?.content;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.facts)) return parsed.facts.slice(0, 10);
    if (Array.isArray(parsed)) return parsed.slice(0, 10);
  } catch (err) {
    logger.warn('Key fact extraction failed', {
      error: err instanceof Error ? err.message : String(err),
      conversationId: conversation.id,
    });
  }

  return [];
}

async function extractTopics(conversation: Conversation): Promise<string[]> {
  const config = loadConfig();
  const transcript = conversation.messages
    .slice(-6)
    .map((m) => `${m.role.toUpperCase()}: ${m.content.slice(0, 300)}`)
    .join('\n');

  const prompt = `Extract the main topics discussed in this conversation. Return ONLY a JSON array of 3-8 topic strings.\n\n${transcript}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You extract topics from conversations. Return only a JSON array of strings.' },
          { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_tokens: 200,
      }),
    });

    if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`);
    const json = await response.json();
    const raw = json.choices?.[0]?.message?.content;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.topics)) return parsed.topics.slice(0, 10);
    if (Array.isArray(parsed)) return parsed.slice(0, 10);
  } catch (err) {
    logger.warn('Topic extraction failed', {
      error: err instanceof Error ? err.message : String(err),
      conversationId: conversation.id,
    });
  }

  return [];
}

async function generateCompressedSummary(combinedText: string): Promise<{ summary: string; keyFacts: string[] }> {
  const config = loadConfig();

  const prompt = `Compress the following memory summaries into a single concise summary with key facts. Return JSON: { "summary": "string", "keyFacts": ["string"] }.\n\n${combinedText.slice(0, 8000)}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You compress memories into higher-level summaries. Return JSON only.' },
          { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: 600,
      }),
    });

    if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`);
    const json = await response.json();
    const raw = json.choices?.[0]?.message?.content;
    const parsed = JSON.parse(raw);
    return {
      summary: String(parsed.summary ?? 'Compressed memory'),
      keyFacts: Array.isArray(parsed.keyFacts) ? parsed.keyFacts.slice(0, 10) : [],
    };
  } catch (err) {
    logger.warn('Compressed summary generation failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      summary: 'Compressed memory summary (generation failed)',
      keyFacts: [],
    };
  }
}

function mapMemorySummary(row: Record<string, unknown>): MemorySummary {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    conversationIds: (row.conversation_ids as string[]) ?? [],
    summary: String(row.summary ?? ''),
    keyFacts: (row.key_facts as string[]) ?? [],
    topics: (row.topics as string[]) ?? [],
    namespace: String(row.namespace ?? 'memory-summaries'),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: String(row.created_at),
    expiresAt: row.expires_at ? String(row.expires_at) : undefined,
  };
}
