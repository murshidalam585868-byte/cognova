/**
 * src/app/api/chat/route.ts
 * Core chat API endpoint for Shadow Brain.
 *
 * - Accepts conversation context + latest user message
 * - Loads conversation history from Supabase
 * - Builds per-user LangGraph with bound tool tokens
 * - Streams response via Server-Sent Events (SSE)
 * - Persists assistant message to Supabase after stream completes
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { HumanMessage, AIMessage, BaseMessage } from '@langchain/core/messages';
import { graph, type ToolTokens } from '@/lib/agent/graph';
import {
  getConversation,
  getMessagesByConversation,
  createConversation,
  saveMessage,
  getUserProfile,
  getToolConfig,
} from '@/lib/db/supabase';
import { logger } from '@/lib/logger';

// ---------------------------------------------------------------------------
// Request Validation
// ---------------------------------------------------------------------------

const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().min(1),
});

const ChatRequestSchema = z.object({
  messages: z.array(ChatMessageSchema).min(1),
  conversationId: z.string().uuid().optional(),
  userId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toLangChainMessage(msg: z.infer<typeof ChatMessageSchema>): BaseMessage {
  switch (msg.role) {
    case 'user':
      return new HumanMessage(msg.content);
    case 'assistant':
      return new AIMessage(msg.content);
    default:
      return new HumanMessage(msg.content);
  }
}

async function loadToolTokens(userId: string): Promise<ToolTokens> {
  const [gmailConfig, calendarConfig] = await Promise.all([
    getToolConfig(userId, 'gmail').catch(() => null),
    getToolConfig(userId, 'calendar').catch(() => null),
  ]);

  return {
    gmail: gmailConfig?.access_token ?? undefined,
    calendar: calendarConfig?.access_token ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// POST Handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<Response> {
  let body: z.infer<typeof ChatRequestSchema>;
  try {
    const json = await req.json();
    body = ChatRequestSchema.parse(json);
  } catch (err) {
    logger.warn('Invalid chat request', { error: (err as Error).message });
    return Response.json({ error: 'Invalid request body', details: (err as Error).message }, { status: 400 });
  }

  const { messages: clientMessages, userId } = body;
  let conversationId = body.conversationId;

  try {
    // Resolve or create conversation
    if (conversationId) {
      const conv = await getConversation(conversationId);
      if (!conv || conv.userId !== userId) {
        return Response.json({ error: 'Conversation not found or access denied' }, { status: 404 });
      }
    } else {
      const conv = await createConversation(userId, 'New Conversation');
      conversationId = conv.id;
    }

    // Load prior DB messages (if conversation existed and client only sent last msg)
    // Strategy: use client's full message history if it includes system/assistant turns.
    // If client only sent one user message, load history from DB and prepend.
    let allMessages: BaseMessage[] = clientMessages.map(toLangChainMessage);

    if (clientMessages.length === 1 && clientMessages[0].role === 'user') {
      const dbMessages = await getMessagesByConversation(conversationId);
      const history = dbMessages
        .filter((m) => m.role !== 'tool')
        .map((m) => toLangChainMessage({ role: m.role as 'user' | 'assistant' | 'system', content: m.content }));
      allMessages = [...history, ...allMessages];
    }

    // Persist the latest user message (if not already in DB from a prior request)
    const lastClientMsg = clientMessages[clientMessages.length - 1];
    if (lastClientMsg.role === 'user') {
      await saveMessage(conversationId, {
        role: 'user',
        content: lastClientMsg.content,
        metadata: {},
      });
    }

    // Load user preferences and tool tokens
    const [profile, toolTokens] = await Promise.all([
      getUserProfile(userId),
      loadToolTokens(userId),
    ]);

    const preferences = profile?.preferences ?? {
      tone: 'detailed',
      verbosity: 'standard',
      responseStyle: 'collaborative',
      timezone: 'UTC',
      language: 'en',
      topicsOfInterest: [],
      industries: [],
    };

    // Build initial graph state
    const initialState = {
      messages: allMessages,
      userId,
      conversationId,
      preferences,
      toolTokens,
    };

    // -----------------------------------------------------------------------
    // Streaming Response
    // -----------------------------------------------------------------------

    const encoder = new TextEncoder();
    let fullResponse = '';

    const stream = new ReadableStream({
      async start(controller) {
        let fullResponse = '';

        try {
          const eventStream = await graph.streamEvents(initialState as any, {
            version: 'v2' as const,
            metadata: { conversationId, userId },
          });

          for await (const event of eventStream) {
            // Stream tokens from the LLM
            if (event.event === 'on_chat_model_stream') {
              const chunk = event.data?.chunk;
              const content = chunk?.content;
              if (content && typeof content === 'string') {
                fullResponse += content;
                const payload = JSON.stringify({ type: 'token', token: content });
                controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
              }
            }

            // Optionally stream tool start/end events for UX feedback
            if (event.event === 'on_tool_start') {
              const payload = JSON.stringify({
                type: 'tool_start',
                name: event.name,
                input: event.data?.input,
              });
              controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
            }

            if (event.event === 'on_tool_end') {
              const payload = JSON.stringify({
                type: 'tool_end',
                name: event.name,
                output: event.data?.output,
              });
              controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
            }
          }

          // Final done marker
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
          controller.close();
        } catch (streamErr) {
          logger.error('Chat stream error', {
            error: (streamErr as Error).message,
            conversationId,
            userId,
          });
          const payload = JSON.stringify({
            type: 'error',
            message: (streamErr as Error).message,
          });
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
          controller.close();
        }

        // Persist assistant response to Supabase after streaming completes
        try {
          if (fullResponse.trim()) {
            await saveMessage(conversationId!, {
              role: 'assistant',
              content: fullResponse,
              metadata: { streamed: true },
            });
          }
        } catch (saveErr) {
          logger.error('Failed to save assistant message', {
            error: (saveErr as Error).message,
            conversationId,
          });
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (err) {
    logger.error('Chat endpoint error', { error: (err as Error).message, userId, conversationId });
    return Response.json(
      { error: 'Internal server error', details: (err as Error).message },
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
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
