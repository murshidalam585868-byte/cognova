import { Pinecone } from '@pinecone-database/pinecone';
import { AppConfig } from '../config';
import { MemoryEntry } from '../../types';

/**
 * Shadow Brain — Embedding & Memory Pipeline
 * Phase 2: Digital Shadow Self
 *
 * Handles OpenAI text embeddings and Pinecone vector operations.
 * Uses per-user namespaces:
 *   - user-{id}-memory      : conversation summaries and facts
 *   - user-{id}-preferences : embedded preference snapshots
 */

// ------------------------------------------------------------------
// Pinecone Singleton
// ------------------------------------------------------------------
let pineconeInstance: Pinecone | null = null;

function getPinecone(config: AppConfig): Pinecone {
  if (!pineconeInstance) {
    pineconeInstance = new Pinecone({ apiKey: config.pineconeApiKey });
  }
  return pineconeInstance;
}

export function getMemoryNamespace(userId: string): string {
  return `user-${userId}-memory`;
}

export function getPreferencesNamespace(userId: string): string {
  return `user-${userId}-preferences`;
}

// ------------------------------------------------------------------
// OpenAI Embeddings
// ------------------------------------------------------------------
/**
 * Creates a vector embedding for the supplied text using OpenAI.
 *
 * @param text - The text to embed.
 * @param config - AppConfig with OpenAI API key.
 * @returns A float array embedding (1536 dims for text-embedding-3-small).
 */
export async function createEmbedding(text: string, config: AppConfig): Promise<number[]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.openaiApiKey}`,
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text,
      encoding_format: 'float',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Embedding API error: ${res.status} ${text}`);
  }

  const json = await res.json();
  const embedding = json.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) {
    throw new Error(`Invalid embedding response: ${JSON.stringify(json)}`);
  }
  return embedding as number[];
}

// ------------------------------------------------------------------
// Pinecone Upserts
// ------------------------------------------------------------------
/**
 * Stores a memory entry into the user's Pinecone memory namespace.
 *
 * @param userId - The user ID.
 * @param content - The text content (e.g., conversation summary).
 * @param metadata - Arbitrary metadata to attach to the vector.
 * @param config - AppConfig.
 * @returns The generated Pinecone record ID.
 */
export async function storeMemory(
  userId: string,
  content: string,
  metadata: Record<string, unknown>,
  config: AppConfig
): Promise<string> {
  const embedding = await createEmbedding(content, config);
  const pc = getPinecone(config);
  const index = pc.index(config.pineconeIndex);
  const namespace = index.namespace(getMemoryNamespace(userId));

  const id = `mem-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  await namespace.upsert([
    {
      id,
      values: embedding,
      metadata: {
        ...metadata,
        content,
        userId,
        createdAt: new Date().toISOString(),
      },
    },
  ]);

  return id;
}

/**
 * Stores a snapshot of the current user preferences as a vector in the
 * preferences namespace. This enables semantic similarity search across
 * preference states over time.
 *
 * @param userId - The user ID.
 * @param preferences - The preferences object to embed.
 * @param config - AppConfig.
 * @returns The generated Pinecone record ID.
 */
export async function storePreferencesSnapshot(
  userId: string,
  preferences: Record<string, unknown>,
  config: AppConfig
): Promise<string> {
  const content = JSON.stringify(preferences);
  const embedding = await createEmbedding(content, config);
  const pc = getPinecone(config);
  const index = pc.index(config.pineconeIndex);
  const namespace = index.namespace(getPreferencesNamespace(userId));

  const id = `prefs-${userId}-${Date.now()}`;

  await namespace.upsert([
    {
      id,
      values: embedding,
      metadata: {
        content,
        userId,
        createdAt: new Date().toISOString(),
      },
    },
  ]);

  return id;
}

// ------------------------------------------------------------------
// Pinecone Query
// ------------------------------------------------------------------
/**
 * Queries the user's memory namespace for semantically similar entries.
 *
 * @param userId - The user ID.
 * @param query - The query text (e.g., last user message).
 * @param topK - Number of results to return.
 * @param config - AppConfig.
 * @returns An array of MemoryEntry objects (embedding omitted for bandwidth).
 */
export async function queryMemory(
  userId: string,
  query: string,
  topK: number,
  config: AppConfig
): Promise<MemoryEntry[]> {
  const embedding = await createEmbedding(query, config);
  const pc = getPinecone(config);
  const index = pc.index(config.pineconeIndex);
  const namespace = index.namespace(getMemoryNamespace(userId));

  const results = await namespace.query({
    vector: embedding,
    topK,
    includeMetadata: true,
  });

  return (results.matches || []).map((match) => ({
    id: match.id,
    userId: (match.metadata?.userId as string) || userId,
    namespace: getMemoryNamespace(userId),
    content: (match.metadata?.content as string) || '',
    embedding: [], // omitted to save bandwidth; re-fetch if needed
    metadata: (match.metadata as Record<string, unknown>) || {},
    createdAt: (match.metadata?.createdAt as string) || new Date().toISOString(),
  }));
}
