/**
 * src/app/api/upload/route.ts
 * Multipart file upload endpoint for PDF, DOCX, TXT, and MD.
 *
 * POST /api/upload
 *   - Accepts multipart/form-data with fields: file, userId, metadata (optional JSON string)
 *   - Validates file size (max 50MB) and MIME type
 *   - Delegates to the ingest pipeline
 *   - Returns JSON with documentId, chunkCount, status
 *
 * DELETE /api/upload
 *   - Accepts JSON body with { documentId, userId }
 *   - Deletes document, chunks, and Pinecone vectors
 *
 * OPTIONS
 *   - CORS preflight
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { ingestDocument, deleteDocument } from '@/lib/upload/ingest';

// Force Node.js runtime for file buffer operations
export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

const UploadFormSchema = z.object({
  userId: z.string().uuid(),
  metadata: z.string().optional(),
});

const DeleteBodySchema = z.object({
  documentId: z.string().uuid(),
  userId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// POST Handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const formData = await req.formData();

    const file = formData.get('file');
    if (!file || !(file instanceof File)) {
      return Response.json({ error: 'Missing or invalid file field' }, { status: 400 });
    }

    const userId = formData.get('userId');
    const metadataRaw = formData.get('metadata');

    if (typeof userId !== 'string') {
      return Response.json({ error: 'Missing or invalid userId field' }, { status: 400 });
    }

    let metadata: Record<string, unknown> = {};
    if (typeof metadataRaw === 'string' && metadataRaw.length > 0) {
      try {
        metadata = JSON.parse(metadataRaw);
      } catch {
        return Response.json({ error: 'Invalid metadata JSON string' }, { status: 400 });
      }
    }

    const formValidation = UploadFormSchema.safeParse({ userId, metadata: metadataRaw ?? undefined });
    if (!formValidation.success) {
      return Response.json(
        { error: 'Invalid form data', details: formValidation.error.format() },
        { status: 400 }
      );
    }

    // Validate file constraints
    if (file.size > MAX_FILE_SIZE) {
      return Response.json(
        { error: `File too large. Max size: ${MAX_FILE_SIZE / 1024 / 1024} MB` },
        { status: 413 }
      );
    }

    const supportedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'text/markdown',
      'text/x-markdown',
    ];

    if (!supportedTypes.includes(file.type)) {
      return Response.json(
        { error: `Unsupported file type: ${file.type}. Supported: PDF, DOCX, TXT, MD` },
        { status: 415 }
      );
    }

    // Convert File to Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    logger.info('Upload request received', {
      userId,
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
    });

    // Run ingest pipeline
    const result = await ingestDocument({
      userId,
      fileName: file.name,
      mimeType: file.type,
      buffer,
      metadata,
    });

    return Response.json({
      success: true,
      documentId: result.documentId,
      chunkCount: result.chunkCount,
      namespace: result.namespace,
      status: 'completed',
    }, { status: 201 });
  } catch (err) {
    const message = (err as Error).message;
    logger.error('Upload endpoint error', { error: message });

    return Response.json(
      { error: 'Ingest failed', details: message },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE Handler
// ---------------------------------------------------------------------------

export async function DELETE(req: NextRequest): Promise<Response> {
  try {
    const body = await req.json();
    const validation = DeleteBodySchema.safeParse(body);

    if (!validation.success) {
      return Response.json(
        { error: 'Invalid request body', details: validation.error.format() },
        { status: 400 }
      );
    }

    const { documentId, userId } = validation.data;

    await deleteDocument(documentId, userId);

    return Response.json({ success: true, documentId }, { status: 200 });
  } catch (err) {
    const message = (err as Error).message;
    logger.error('Delete endpoint error', { error: message });

    return Response.json(
      { error: 'Delete failed', details: message },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// OPTIONS (CORS preflight)
// ---------------------------------------------------------------------------

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
