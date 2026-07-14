/**
 * src/lib/vector/pinecone.ts
 * Pinecone vector store client for RAG and long-term memory.
 * Provides upsert, query, delete, and namespace management.
 */

import { Pinecone, Index, RecordMetadata } from '@pinecone-database/pinecone';
import { loadConfig } from '@/lib/config';
import { logger } from '@/lib/logger';

// ---------------------------------------------------------------------------
// Client Singleton
// ---------------------------------------------------------------------------

let pinecone: Pinecone | null = null;
let index: Index | null = null;

function getPineconeClient(): Pinecone {
  if (pinecone) return pinecone;

  const config = loadConfig();
  if (!config.pineconeApiKey) {
    throw new Error('PINECONE_API_KEY is not configured.');
  }

  pinecone = new Pinecone({ apiKey: config.pineconeApiKey });
  return pinecone;
}

export function getPineconeIndex(): Index {
  if (index) return index;

  const config = loadConfig();
  const client = getPineconeClient();
  const indexName = config.pineconeIndex;

  index = client.index(indexName);
  logger.info('Pinecone index connected', { index: indexName });
  return index;
}

// ---------------------------------------------------------------------------
// Core Vector Operations
// ---------------------------------------------------------------------------

export interface VectorRecord {
  id: string;
  values: number[];
  metadata?: RecordMetadata;
}

/**
 * Upsert vectors into a Pinecone namespace.
 */
export async function upsertVectors(
  vectors: VectorRecord[],
  namespace: string
): Promise<void> {
  const idx = getPineconeIndex();

  try {
    await idx.namespace(namespace).upsert(vectors);
    logger.info('Vectors upserted', { count: vectors.length, namespace });
  } catch (err) {
    logger.error('Failed to upsert vectors', { error: err, namespace });
    throw err;
  }
}

/**
 * Query vectors from a Pinecone namespace.
 * Returns topK matches with scores and metadata.
 */
export async function queryVectors(
  vector: number[],
  namespace: string,
  topK = 5,
  filter?: Record<string, unknown>
): Promise<
  {
    id: string;
    score: number;
    metadata?: RecordMetadata;
  }[]
> {
  const idx = getPineconeIndex();

  try {
    const result = await idx.namespace(namespace).query({
      vector,
      topK,
      includeMetadata: true,
      filter,
    });

    const matches =
      result.matches?.map((m) => ({
        id: m.id,
        score: m.score ?? 0,
        metadata: m.metadata,
      })) ?? [];

    logger.info('Vector query executed', { namespace, topK, matches: matches.length });
    return matches;
  } catch (err) {
    logger.error('Failed to query vectors', { error: err, namespace });
    throw err;
  }
}

/**
 * Delete vectors by ID from a namespace.
 */
export async function deleteVectors(ids: string[], namespace: string): Promise<void> {
  const idx = getPineconeIndex();

  try {
    await idx.namespace(namespace).deleteMany(ids);
    logger.info('Vectors deleted', { count: ids.length, namespace });
  } catch (err) {
    logger.error('Failed to delete vectors', { error: err, namespace });
    throw err;
  }
}

/**
 * Delete all vectors in a namespace.
 */
export async function clearNamespace(namespace: string): Promise<void> {
  const idx = getPineconeIndex();

  try {
    await idx.namespace(namespace).deleteAll();
    logger.info('Namespace cleared', { namespace });
  } catch (err) {
    logger.error('Failed to clear namespace', { error: err, namespace });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Embedding Helper
// ---------------------------------------------------------------------------

/**
 * Generate OpenAI embeddings for a batch of texts.
 * This is a lightweight wrapper so callers don't need to import OpenAI directly.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const { OpenAIEmbeddings } = await import('@langchain/openai');
  const config = loadConfig();

  const embedder = new OpenAIEmbeddings({
    apiKey: config.openaiApiKey,
    modelName: 'text-embedding-3-small',
  });

  return embedder.embedDocuments(texts);
}

/**
 * Upsert text chunks into Pinecone after embedding them.
 */
export async function upsertTexts(
  items: { id: string; text: string; metadata?: RecordMetadata }[],
  namespace: string
): Promise<void> {
  if (items.length === 0) return;

  const texts = items.map((i) => i.text);
  const embeddings = await embedTexts(texts);

  const vectors: VectorRecord[] = items.map((item, i) => ({
    id: item.id,
    values: embeddings[i],
    metadata: { text: item.text, ...item.metadata },
  }));

  await upsertVectors(vectors, namespace);
}

/**
 * Retrieve relevant texts from Pinecone for a query string.
 */
export async function retrieveRelevantTexts(
  query: string,
  namespace: string,
  topK = 5
): Promise<{ text: string; score: number; metadata?: RecordMetadata }[]> {
  const { OpenAIEmbeddings } = await import('@langchain/openai');
  const config = loadConfig();

  const embedder = new OpenAIEmbeddings({
    apiKey: config.openaiApiKey,
    modelName: 'text-embedding-3-small',
  });

  const queryVector = await embedder.embedQuery(query);
  const matches = await queryVectors(queryVector, namespace, topK);

  return matches.map((m) => ({
    text: String(m.metadata?.text ?? ''),
    score: m.score,
    metadata: m.metadata,
  }));
}
