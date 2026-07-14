/**
 * src/lib/upload/ingest.ts
 * Ingest pipeline: parse → chunk → embed → upsert to Pinecone + Supabase.
 */

import { z } from 'zod';
import { getSupabaseClient } from '@/lib/db/supabase';
import { embedTexts, upsertVectors, deleteVectors } from '@/lib/vector/pinecone';
import { logger } from '@/lib/logger';
import { parseFile } from './parser';
import { chunkText, mergeSmallChunks } from './chunker';
import type { Document } from '@/types';

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

export const IngestInputSchema = z.object({
  userId: z.string().uuid(),
  fileName: z.string().min(1).max(500),
  mimeType: z.string().min(1),
  buffer: z.instanceof(Buffer),
  metadata: z.record(z.unknown()).default({}),
});
export type IngestInput = z.infer<typeof IngestInputSchema>;

export const IngestResultSchema = z.object({
  documentId: z.string().uuid(),
  chunkCount: z.number().int().nonnegative(),
  namespace: z.string(),
  pineconeIds: z.array(z.string()),
});
export type IngestResult = z.infer<typeof IngestResultSchema>;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_CHUNK_CONFIG = {
  maxChunkSize: 1000,
  chunkOverlap: 200,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Ingest a single document into the knowledge base.
 *
 * Steps:
 * 1. Parse file → text
 * 2. Save document record (pending)
 * 3. Create ingest job
 * 4. Chunk text
 * 5. Embed chunks
 * 6. Upsert to Pinecone
 * 7. Save chunk metadata to Supabase
 * 8. Mark document + job as completed
 */
export async function ingestDocument(input: IngestInput): Promise<IngestResult> {
  const sb = getSupabaseClient();

  // Validate input
  const validated = IngestInputSchema.parse(input);
  const { userId, fileName, mimeType, buffer, metadata } = validated;

  // 1. Parse
  logger.info('Starting document ingest', { userId, fileName, mimeType });
  const parsed = await parseFile(buffer, mimeType);

  // 2. Insert document record
  const { data: docRow, error: docError } = await sb
    .from('documents')
    .insert({
      user_id: userId,
      file_name: fileName,
      mime_type: mimeType,
      size_bytes: buffer.length,
      text_content: parsed.text,
      metadata: { ...metadata, parserMetadata: parsed.metadata },
      status: 'processing',
    })
    .select()
    .single();

  if (docError || !docRow) {
    logger.error('Failed to insert document', { error: docError, userId, fileName });
    throw new Error(`Document insert failed: ${docError?.message ?? 'unknown'}`);
  }

  const documentId = docRow.id as string;

  // 3. Create ingest job
  const { data: jobRow, error: jobError } = await sb
    .from('ingest_jobs')
    .insert({
      document_id: documentId,
      user_id: userId,
      status: 'running',
      stage: 'chunking',
      progress: 0,
    })
    .select()
    .single();

  if (jobError || !jobRow) {
    logger.error('Failed to create ingest job', { error: jobError, documentId });
    throw new Error(`Ingest job creation failed: ${jobError?.message ?? 'unknown'}`);
  }

  const jobId = jobRow.id as string;

  try {
    // 4. Chunk
    const rawChunks = chunkText(parsed.text, DEFAULT_CHUNK_CONFIG);
    const chunks = mergeSmallChunks(rawChunks, DEFAULT_CHUNK_CONFIG);

    await updateJobProgress(jobId, 25, 'embedding');

    // 5. Embed
    const texts = chunks.map((c) => c.text);
    const embeddings = await embedTexts(texts);

    await updateJobProgress(jobId, 50, 'upserting');

    // 6. Upsert to Pinecone
    const namespace = getDocumentNamespace(userId);
    const pineconeIds = chunks.map((c) => `${documentId}-${c.index}`);

    const vectors = chunks.map((chunk, i) => ({
      id: pineconeIds[i],
      values: embeddings[i],
      metadata: {
        documentId,
        userId,
        chunkIndex: chunk.index,
        text: chunk.text,
        tokenCount: chunk.tokenCount,
        sourceFile: fileName,
        createdAt: new Date().toISOString(),
      },
    }));

    await upsertVectors(vectors, namespace);

    await updateJobProgress(jobId, 75, 'saving_chunks');

    // 7. Save chunks to Supabase
    const chunkRows = chunks.map((chunk, i) => ({
      document_id: documentId,
      user_id: userId,
      text: chunk.text,
      index: chunk.index,
      start_char: chunk.startChar,
      end_char: chunk.endChar,
      token_count: chunk.tokenCount,
      pinecone_id: pineconeIds[i],
      metadata: {
        sourceFile: fileName,
        mimeType,
      },
    }));

    const { error: chunkError } = await sb.from('chunks').insert(chunkRows);

    if (chunkError) {
      throw new Error(`Chunk insert failed: ${chunkError.message}`);
    }

    await updateJobProgress(jobId, 100, 'completed');

    // 8. Mark document completed
    await sb
      .from('documents')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('id', documentId);

    await sb
      .from('ingest_jobs')
      .update({
        status: 'completed',
        stage: 'completed',
        progress: 100,
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    logger.info('Document ingest completed', {
      documentId,
      chunkCount: chunks.length,
      namespace,
    });

    return IngestResultSchema.parse({
      documentId,
      chunkCount: chunks.length,
      namespace,
      pineconeIds,
    });
  } catch (err) {
    const message = (err as Error).message;
    logger.error('Document ingest failed', { documentId, error: message });

    await sb
      .from('documents')
      .update({ status: 'failed', error_message: message, updated_at: new Date().toISOString() })
      .eq('id', documentId);

    await sb
      .from('ingest_jobs')
      .update({
        status: 'failed',
        stage: 'failed',
        error_message: message,
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    throw err;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDocumentNamespace(userId: string): string {
  return `user-${userId}-documents`;
}

async function updateJobProgress(jobId: string, progress: number, stage: string): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb
    .from('ingest_jobs')
    .update({ progress, stage })
    .eq('id', jobId);

  if (error) {
    logger.warn('Failed to update ingest job progress', { jobId, error });
  }
}

// ---------------------------------------------------------------------------
// Document Retrieval & Deletion
// ---------------------------------------------------------------------------

/**
 * List all documents for a user with their chunk counts.
 */
export async function listDocuments(userId: string): Promise<(Document & { chunkCount: number })[]> {
  const sb = getSupabaseClient();

  const { data, error } = await sb
    .from('documents')
    .select('*, chunks(count)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    logger.error('Failed to list documents', { error, userId });
    throw new Error(`DB error: ${error.message}`);
  }

  return (data || []).map((row) => ({
    id: String(row.id),
    userId: String(row.user_id),
    fileName: String(row.file_name),
    mimeType: String(row.mime_type),
    sizeBytes: Number(row.size_bytes),
    textContent: String(row.text_content || ''),
    metadata: (row.metadata as Record<string, unknown>) || {},
    status: row.status as Document['status'],
    errorMessage: row.error_message ? String(row.error_message) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    chunkCount: Number(row.chunks?.count || 0),
  }));
}

/**
 * Delete a document and all its associated chunks + vectors.
 */
export async function deleteDocument(documentId: string, userId: string): Promise<void> {
  const sb = getSupabaseClient();

  // Fetch chunk IDs to delete from Pinecone
  const { data: chunks, error: chunkError } = await sb
    .from('chunks')
    .select('pinecone_id')
    .eq('document_id', documentId)
    .eq('user_id', userId);

  if (chunkError) {
    logger.error('Failed to fetch chunks for deletion', { error: chunkError, documentId });
    throw new Error(`DB error: ${chunkError.message}`);
  }

  const ids = (chunks || []).map((c) => String(c.pinecone_id));
  const namespace = getDocumentNamespace(userId);

  if (ids.length > 0) {
    await deleteVectors(ids, namespace);
  }

  // Delete document (cascades to chunks via FK, but Pinecone needs manual cleanup)
  const { error } = await sb.from('documents').delete().eq('id', documentId).eq('user_id', userId);

  if (error) {
    logger.error('Failed to delete document', { error, documentId });
    throw new Error(`DB error: ${error.message}`);
  }

  logger.info('Document deleted', { documentId, userId, vectorsDeleted: ids.length });
}

/**
 * Re-ingest an existing document (e.g., after updating parser/chunker).
 */
export async function reingestDocument(documentId: string, userId: string): Promise<IngestResult> {
  const sb = getSupabaseClient();

  const { data, error } = await sb
    .from('documents')
    .select('*')
    .eq('id', documentId)
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    throw new Error(`Document not found: ${documentId}`);
  }

  // Delete old vectors first
  await deleteDocument(documentId, userId);

  // Re-ingest with the stored text content
  const buffer = Buffer.from(String(data.text_content || ''), 'utf-8');

  return ingestDocument({
    userId,
    fileName: String(data.file_name),
    mimeType: String(data.mime_type),
    buffer,
    metadata: (data.metadata as Record<string, unknown>) || {},
  });
}
