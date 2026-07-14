/**
 * src/lib/tools/gmail.ts
 * Gmail API tools for the LangGraph agent.
 * Provides search, read, and send capabilities wrapped as structured LangChain tools.
 */

import { google, gmail_v1 } from 'googleapis';
import { z } from 'zod';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { logger } from '@/lib/logger';

// ---------------------------------------------------------------------------
// Gmail Client Factory
// ---------------------------------------------------------------------------

function createGmailClient(accessToken: string): gmail_v1.Gmail {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.gmail({ version: 'v1', auth });
}

// ---------------------------------------------------------------------------
// Tool: Search Gmail
// ---------------------------------------------------------------------------

const SearchGmailSchema = z.object({
  query: z.string().describe('Gmail search query (e.g., "from:boss@company.com subject:Q4").'),
  maxResults: z.number().int().min(1).max(50).default(10).describe('Maximum number of results to return.'),
  accessToken: z.string().describe('OAuth2 access token for Gmail.'),
});

export const searchGmailTool = new DynamicStructuredTool({
  name: 'search_gmail',
  description:
    'Search the user\'s Gmail inbox using a Gmail query string. Returns message IDs, thread IDs, ' +
    'subject, sender, and snippet for each match.',
  schema: SearchGmailSchema,
  func: async ({ query, maxResults, accessToken }) => {
    try {
      const gmail = createGmailClient(accessToken);
      const res = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults,
      });

      const messages = res.data.messages ?? [];
      if (messages.length === 0) {
        return JSON.stringify({ results: [], count: 0, query });
      }

      const details = await Promise.all(
        messages.map(async (msg) => {
          if (!msg.id) return null;
          const detail = await gmail.users.messages.get({
            userId: 'me',
            id: msg.id,
            format: 'metadata',
            metadataHeaders: ['Subject', 'From', 'Date'],
          });

          const headers = detail.data.payload?.headers ?? [];
          const subject = headers.find((h) => h.name === 'Subject')?.value ?? '(no subject)';
          const from = headers.find((h) => h.name === 'From')?.value ?? '(unknown)';
          const date = headers.find((h) => h.name === 'Date')?.value ?? '';

          return {
            id: msg.id,
            threadId: msg.threadId,
            subject,
            from,
            date,
            snippet: detail.data.snippet ?? '',
          };
        })
      );

      const results = details.filter(Boolean);
      return JSON.stringify({ results, count: results.length, query });
    } catch (err) {
      logger.error('Gmail search failed', { error: (err as Error).message, query });
      return JSON.stringify({ error: (err as Error).message, query });
    }
  },
});

// ---------------------------------------------------------------------------
// Tool: Read Gmail Message
// ---------------------------------------------------------------------------

const ReadGmailSchema = z.object({
  messageId: z.string().describe('The Gmail message ID to read.'),
  accessToken: z.string().describe('OAuth2 access token for Gmail.'),
});

export const readGmailTool = new DynamicStructuredTool({
  name: 'read_gmail',
  description:
    'Read the full content of a specific Gmail message by ID. Returns headers, body text, and attachments list.',
  schema: ReadGmailSchema,
  func: async ({ messageId, accessToken }) => {
    try {
      const gmail = createGmailClient(accessToken);
      const res = await gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full',
      });

      const data = res.data;
      const headers = data.payload?.headers ?? [];
      const subject = headers.find((h) => h.name === 'Subject')?.value ?? '(no subject)';
      const from = headers.find((h) => h.name === 'From')?.value ?? '';
      const to = headers.find((h) => h.name === 'To')?.value ?? '';
      const date = headers.find((h) => h.name === 'Date')?.value ?? '';

      // Extract body text (prefer text/plain, fallback to text/html stripped)
      let body = '';
      const extractBody = (part: gmail_v1.Schema$MessagePart): string => {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          return Buffer.from(part.body.data, 'base64').toString('utf-8');
        }
        if (part.parts) {
          return part.parts.map(extractBody).join('\n');
        }
        return '';
      };

      if (data.payload) {
        body = extractBody(data.payload);
      }

      const attachments =
        data.payload?.parts
          ?.filter((p) => p.filename && p.filename.length > 0)
          .map((p) => ({
            filename: p.filename,
            mimeType: p.mimeType,
            attachmentId: p.body?.attachmentId,
          })) ?? [];

      return JSON.stringify({
        id: data.id,
        threadId: data.threadId,
        subject,
        from,
        to,
        date,
        body: body.slice(0, 8000), // Truncate to avoid token blowout
        attachments,
      });
    } catch (err) {
      logger.error('Gmail read failed', { error: (err as Error).message, messageId });
      return JSON.stringify({ error: (err as Error).message, messageId });
    }
  },
});

// ---------------------------------------------------------------------------
// Tool: Send Gmail
// ---------------------------------------------------------------------------

const SendGmailSchema = z.object({
  to: z.string().describe('Recipient email address.'),
  subject: z.string().describe('Email subject line.'),
  body: z.string().describe('Plain text email body.'),
  accessToken: z.string().describe('OAuth2 access token for Gmail.'),
  cc: z.string().optional().describe('CC recipients (comma-separated).'),
});

export const sendGmailTool = new DynamicStructuredTool({
  name: 'send_gmail',
  description:
    'Send a plain-text email via Gmail. Returns the sent message ID on success.',
  schema: SendGmailSchema,
  func: async ({ to, subject, body, accessToken, cc }) => {
    try {
      const gmail = createGmailClient(accessToken);

      const lines = [`To: ${to}`, `Subject: ${subject}`];
      if (cc) lines.push(`Cc: ${cc}`);
      lines.push('', body);

      const raw = Buffer.from(lines.join('\r\n'))
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const res = await gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw },
      });

      logger.info('Email sent via Gmail', { messageId: res.data.id, to });
      return JSON.stringify({ success: true, messageId: res.data.id, to });
    } catch (err) {
      logger.error('Gmail send failed', { error: (err as Error).message, to });
      return JSON.stringify({ error: (err as Error).message, to });
    }
  },
});

// ---------------------------------------------------------------------------
// Tool Registry Export
// ---------------------------------------------------------------------------

export const gmailTools = [searchGmailTool, readGmailTool, sendGmailTool];
