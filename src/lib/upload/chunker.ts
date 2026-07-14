/**
 * src/lib/upload/chunker.ts
 * Semantic chunking with recursive splitting and overlap.
 *
 * Strategy:
 * 1. Split by paragraphs (\n\n).
 * 2. If a paragraph is too large, split by sentences.
 * 3. If a sentence is too large, split by words.
 * 4. If a word is too large, split by characters.
 * 5. Respect max chunk size and maintain overlap between chunks.
 */

import { z } from 'zod';
import { logger } from '@/lib/logger';

// ---------------------------------------------------------------------------
// Zod Config
// ---------------------------------------------------------------------------

export const ChunkConfigSchema = z.object({
  maxChunkSize: z.number().int().min(100).max(8000).default(1000),
  chunkOverlap: z.number().int().min(0).max(2000).default(200),
  separators: z.array(z.string()).default(['\n\n', '\n', '. ', '! ', '? ', ' ', '']),
});
export type ChunkConfig = z.infer<typeof ChunkConfigSchema>;

export const ChunkSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  index: z.number().int().nonnegative(),
  startChar: z.number().int().nonnegative(),
  endChar: z.number().int().nonnegative(),
  tokenCount: z.number().int().nonnegative(),
});
export type Chunk = z.infer<typeof ChunkSchema>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOKEN_ESTIMATE_CHARS = 4; // rough approximation: 1 token ≈ 4 chars

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Split a long text into semantically coherent chunks.
 *
 * @param text - The raw text to chunk.
 * @param config - Chunking configuration.
 * @returns An ordered array of Chunk objects.
 */
export function chunkText(text: string, config?: Partial<ChunkConfig>): Chunk[] {
  const opts = ChunkConfigSchema.parse({ ...config });
  const maxChars = opts.maxChunkSize * TOKEN_ESTIMATE_CHARS;
  const overlapChars = opts.chunkOverlap * TOKEN_ESTIMATE_CHARS;

  const chunks: Chunk[] = [];
  const candidateChunks = recursiveSplit(text, opts.separators, maxChars);

  let currentIndex = 0;
  let currentStart = 0;

  for (const candidate of candidateChunks) {
    const chunkText = candidate.trim();
    if (!chunkText) continue;

    const endChar = currentStart + chunkText.length;
    const tokenCount = Math.ceil(chunkText.length / TOKEN_ESTIMATE_CHARS);

    chunks.push({
      id: generateChunkId(),
      text: chunkText,
      index: currentIndex,
      startChar: currentStart,
      endChar,
      tokenCount,
    });

    currentIndex += 1;
    currentStart = endChar - overlapChars;
    if (currentStart < 0) currentStart = 0;
  }

  logger.info('Text chunked', {
    totalChars: text.length,
    chunkCount: chunks.length,
    avgChunkSize: Math.round(text.length / (chunks.length || 1)),
  });

  return chunks;
}

/**
 * Merge small chunks that fit together under the max size limit.
 * Useful for post-processing when chunks are too granular.
 */
export function mergeSmallChunks(chunks: Chunk[], config?: Partial<ChunkConfig>): Chunk[] {
  const opts = ChunkConfigSchema.parse({ ...config });
  const maxChars = opts.maxChunkSize * TOKEN_ESTIMATE_CHARS;

  if (chunks.length === 0) return [];

  const merged: Chunk[] = [];
  let current = chunks[0];

  for (let i = 1; i < chunks.length; i++) {
    const next = chunks[i];
    const combinedLength = current.text.length + 1 + next.text.length;

    if (combinedLength <= maxChars) {
      current = {
        ...current,
        id: generateChunkId(),
        text: `${current.text}\n\n${next.text}`,
        endChar: next.endChar,
        tokenCount: Math.ceil(combinedLength / TOKEN_ESTIMATE_CHARS),
      };
    } else {
      merged.push(current);
      current = next;
    }
  }
  merged.push(current);

  // Re-index
  return merged.map((c, idx) => ({ ...c, index: idx }));
}

// ---------------------------------------------------------------------------
// Recursive Splitter
// ---------------------------------------------------------------------------

function recursiveSplit(text: string, separators: string[], maxChars: number): string[] {
  if (text.length <= maxChars) {
    return [text];
  }

  if (separators.length === 0) {
    // Hard split by character
    return splitByLength(text, maxChars);
  }

  const [separator, ...remaining] = separators;
  const parts = text.split(separator);

  const result: string[] = [];
  let current = '';

  for (const part of parts) {
    const candidate = current ? `${current}${separator}${part}` : part;

    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) {
        result.push(current);
      }
      // If a single part is too large, recurse deeper
      if (part.length > maxChars) {
        const subParts = recursiveSplit(part, remaining, maxChars);
        result.push(...subParts.slice(0, -1));
        current = subParts[subParts.length - 1] ?? '';
      } else {
        current = part;
      }
    }
  }

  if (current) {
    result.push(current);
  }

  return result;
}

function splitByLength(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += maxChars) {
    chunks.push(text.slice(i, i + maxChars));
  }
  return chunks;
}

function generateChunkId(): string {
  return `chunk-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
