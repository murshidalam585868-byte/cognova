/**
 * src/lib/upload/parser.ts
 * File text extraction for PDF, DOCX, TXT, and MD.
 *
 * Dependencies (install separately):
 *   npm install pdf-parse mammoth
 *
 * Uses dynamic imports so missing packages degrade gracefully with a fallback.
 */

import { z } from 'zod';
import { logger } from '@/lib/logger';

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

export const SupportedMimeType = z.enum([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
  'text/x-markdown',
]);
export type SupportedMimeType = z.infer<typeof SupportedMimeType>;

export const ParsedDocumentSchema = z.object({
  text: z.string().min(0),
  metadata: z.object({
    title: z.string().optional(),
    author: z.string().optional(),
    pageCount: z.number().optional(),
    wordCount: z.number().optional(),
  }).default({}),
});
export type ParsedDocument = z.infer<typeof ParsedDocumentSchema>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a file buffer into plain text based on its MIME type.
 */
export async function parseFile(
  buffer: Buffer,
  mimeType: string
): Promise<ParsedDocument> {
  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    throw new Error(`File exceeds maximum size of ${MAX_FILE_SIZE_BYTES} bytes`);
  }

  const type = SupportedMimeType.safeParse(mimeType);
  if (!type.success) {
    throw new Error(`Unsupported file type: ${mimeType}`);
  }

  switch (type.data) {
    case 'application/pdf':
      return parsePdf(buffer);
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return parseDocx(buffer);
    case 'text/plain':
    case 'text/markdown':
    case 'text/x-markdown':
      return parseText(buffer);
    default:
      throw new Error(`Unhandled file type: ${type.data}`);
  }
}

// ---------------------------------------------------------------------------
// PDF Parser
// ---------------------------------------------------------------------------

async function parsePdf(buffer: Buffer): Promise<ParsedDocument> {
  try {
    const pdfParse = await import('pdf-parse');
    const data = await pdfParse.default(buffer);
    const text = sanitizeText(data.text);

    return ParsedDocumentSchema.parse({
      text,
      metadata: {
        title: data.info?.Title ?? undefined,
        author: data.info?.Author ?? undefined,
        pageCount: data.numpages ?? undefined,
        wordCount: estimateWordCount(text),
      },
    });
  } catch (err) {
    logger.error('PDF parsing failed; install "pdf-parse" to enable PDF support', {
      error: (err as Error).message,
    });
    throw new Error(`PDF parsing failed: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// DOCX Parser
// ---------------------------------------------------------------------------

async function parseDocx(buffer: Buffer): Promise<ParsedDocument> {
  try {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    const text = sanitizeText(result.value);

    return ParsedDocumentSchema.parse({
      text,
      metadata: {
        wordCount: estimateWordCount(text),
      },
    });
  } catch (err) {
    logger.error('DOCX parsing failed; install "mammoth" to enable DOCX support', {
      error: (err as Error).message,
    });
    throw new Error(`DOCX parsing failed: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Plain Text / Markdown Parser
// ---------------------------------------------------------------------------

function parseText(buffer: Buffer): ParsedDocument {
  const text = sanitizeText(buffer.toString('utf-8'));

  return ParsedDocumentSchema.parse({
    text,
    metadata: {
      wordCount: estimateWordCount(text),
    },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitizeText(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u0000/g, '') // null bytes
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // control chars
    .trim();
}

function estimateWordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
