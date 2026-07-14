/**
 * src/lib/agent/graph.ts
 * LangGraph agent workflow for Shadow Brain Phase 1.
 *
 * Architecture:
 *   START → retrieve (RAG lookup) → agent (LLM reasoning + tool binding)
 *   agent → tools (if tool_calls detected) → agent (loop)
 *   agent → END (when no more tool_calls)
 *
 * Supports:
 *   - Streaming via streamEvents
 *   - Tool token binding per-user
 *   - Pinecone RAG context injection
 *   - LangSmith tracing (automatic via env)
 */

import { StateGraph, END, START } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import {
  BaseMessage,
  HumanMessage,
  AIMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { loadConfig } from '@/lib/config';
import { logger } from '@/lib/logger';
import { retrieveRelevantTexts } from '@/lib/vector/pinecone';
import { searchGmailTool, readGmailTool, sendGmailTool } from '@/lib/tools/gmail';
import { listEventsTool, createEventTool, updateEventTool } from '@/lib/tools/calendar';
import type { UserPreferences } from '@/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GraphState {
  messages: BaseMessage[];
  userId: string;
  conversationId?: string;
  preferences: UserPreferences;
  ragContext?: string;
  toolTokens: ToolTokens;
}

export interface ToolTokens {
  gmail?: string;
  calendar?: string;
}

// ---------------------------------------------------------------------------
// System Prompt Builder
// ---------------------------------------------------------------------------

function buildSystemPrompt(preferences: UserPreferences, ragContext?: string): string {
  const parts: string[] = [
    `You are Shadow Brain, an elite AI Business Partner and CEO Office assistant.`,
    `Your role is to help the user with business strategy, operations, research, and daily executive tasks.`,
    `Tone: ${preferences.tone}. Verbosity: ${preferences.verbosity}. Style: ${preferences.responseStyle}.`,
    `Current timezone: ${preferences.timezone}. Language: ${preferences.language}.`,
    `When using tools, think step-by-step and confirm actions with the user when mutating data (sending emails, creating events).`,
  ];

  if (preferences.topicsOfInterest?.length) {
    parts.push(`User topics of interest: ${preferences.topicsOfInterest.join(', ')}.`);
  }
  if (preferences.industries?.length) {
    parts.push(`Industries: ${preferences.industries.join(', ')}.`);
  }
  if (ragContext) {
    parts.push(`\n[RELEVANT CONTEXT FROM KNOWLEDGE BASE]\n${ragContext}\n[END CONTEXT]`);
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Tool Binding Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a proxy tool that injects the user's access token before invoking
 * the underlying tool. This hides auth tokens from the LLM's parameter space.
 */
function bindToken<T extends z.ZodTypeAny>(
  original: DynamicStructuredTool<T>,
  token?: string
): DynamicStructuredTool<T> | null {
  if (!token) return null;

  return new DynamicStructuredTool({
    name: original.name,
    description: original.description,
    schema: original.schema,
    func: async (args) => original.invoke({ ...args, accessToken: token } as z.infer<T>),
  });
}

function buildTools(tokens: ToolTokens): DynamicStructuredTool[] {
  const tools: (DynamicStructuredTool | null)[] = [
    bindToken(searchGmailTool, tokens.gmail),
    bindToken(readGmailTool, tokens.gmail),
    bindToken(sendGmailTool, tokens.gmail),
    bindToken(listEventsTool, tokens.calendar),
    bindToken(createEventTool, tokens.calendar),
    bindToken(updateEventTool, tokens.calendar),
  ];
  return tools.filter(Boolean) as DynamicStructuredTool[];
}

// ---------------------------------------------------------------------------
// LLM Factory
// ---------------------------------------------------------------------------

function createLLM(): ChatOpenAI {
  const config = loadConfig();
  return new ChatOpenAI({
    modelName: 'gpt-4o',
    temperature: 0.3,
    apiKey: config.openaiApiKey,
    // LangSmith tracing is automatic when LANGSMITH_API_KEY is set
  });
}

// ---------------------------------------------------------------------------
// Graph Nodes
// ---------------------------------------------------------------------------

/**
 * Retrieve node: decides whether to query Pinecone and injects RAG context.
 * Uses a lightweight heuristic: if the last user message contains question-like
 * words or references to knowledge, perform retrieval.
 */
async function retrieveNode(state: GraphState): Promise<Partial<GraphState>> {
  const lastMessage = state.messages[state.messages.length - 1];
  if (!(lastMessage instanceof HumanMessage)) {
    return { ragContext: state.ragContext };
  }

  const query = String(lastMessage.content);
  const knowledgeKeywords = /\b(what|how|why|explain|describe|policy|strategy|research|report|data|market|competitor|industry)\b/i;
  const needsRag = knowledgeKeywords.test(query) || query.length > 40;

  if (!needsRag) {
    return { ragContext: state.ragContext };
  }

  try {
    const namespace = `user-${state.userId}-knowledge`;
    const results = await retrieveRelevantTexts(query, namespace, 5);
    if (results.length === 0) {
      return { ragContext: state.ragContext };
    }

    const context = results
      .map((r, i) => `[${i + 1}] (score: ${r.score.toFixed(3)}) ${r.text}`)
      .join('\n---\n');

    logger.info('RAG context retrieved', { userId: state.userId, matches: results.length });
    return { ragContext: context };
  } catch (err) {
    logger.error('RAG retrieval failed', { error: (err as Error).message, userId: state.userId });
    return { ragContext: state.ragContext };
  }
}

/**
 * Agent node: calls the LLM with system prompt, RAG context, and bound tools.
 */
async function agentNode(state: GraphState): Promise<Partial<GraphState>> {
  const llm = createLLM();
  const tools = buildTools(state.toolTokens);
  const modelWithTools = tools.length > 0 ? llm.bindTools(tools) : llm;

  const systemContent = buildSystemPrompt(state.preferences, state.ragContext);
  const systemMessage = new SystemMessage(systemContent);

  const response = await modelWithTools.invoke([systemMessage, ...state.messages]);

  return { messages: [...state.messages, response] };
}

/**
 * Tools node: executes any tool calls requested by the LLM.
 */
async function toolsNode(state: GraphState): Promise<Partial<GraphState>> {
  const lastMessage = state.messages[state.messages.length - 1];
  if (!(lastMessage instanceof AIMessage)) {
    return {};
  }

  const toolCalls = lastMessage.tool_calls;
  if (!toolCalls || toolCalls.length === 0) {
    return {};
  }

  const tools = buildTools(state.toolTokens);
  const toolMap = new Map(tools.map((t) => [t.name, t]));

  const toolMessages: ToolMessage[] = [];

  for (const call of toolCalls) {
    const tool = toolMap.get(call.name);
    if (!tool) {
      toolMessages.push(
        new ToolMessage({
          content: `Error: Tool "${call.name}" not found.`,
          tool_call_id: call.id ?? 'unknown',
        })
      );
      continue;
    }

    try {
      const result = await tool.invoke(call.args);
      toolMessages.push(
        new ToolMessage({
          content: String(result),
          tool_call_id: call.id ?? 'unknown',
        })
      );
    } catch (err) {
      logger.error('Tool execution failed', {
        tool: call.name,
        error: (err as Error).message,
      });
      toolMessages.push(
        new ToolMessage({
          content: `Error executing ${call.name}: ${(err as Error).message}`,
          tool_call_id: call.id ?? 'unknown',
        })
      );
    }
  }

  return { messages: [...state.messages, ...toolMessages] };
}

// ---------------------------------------------------------------------------
// Conditional Edges
// ---------------------------------------------------------------------------

function shouldContinue(state: GraphState): 'tools' | typeof END {
  const lastMessage = state.messages[state.messages.length - 1];
  if (lastMessage instanceof AIMessage && lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
    return 'tools';
  }
  return END;
}

// ---------------------------------------------------------------------------
// Graph Builder
// ---------------------------------------------------------------------------

const workflow = new StateGraph<GraphState>({
  channels: {
    messages: {
      value: (x: BaseMessage[], y: BaseMessage[]) => x.concat(y),
      default: () => [],
    },
    userId: {
      value: (x: string, y: string) => y ?? x,
      default: () => '',
    },
    conversationId: {
      value: (x?: string, y?: string) => y ?? x,
      default: () => undefined,
    },
    preferences: {
      value: (x: UserPreferences, y: UserPreferences) => y ?? x,
      default: () => ({
        tone: 'detailed',
        verbosity: 'standard',
        responseStyle: 'collaborative',
        timezone: 'UTC',
        language: 'en',
        topicsOfInterest: [],
        industries: [],
      }),
    },
    ragContext: {
      value: (x?: string, y?: string) => y ?? x,
      default: () => undefined,
    },
    toolTokens: {
      value: (x: ToolTokens, y: ToolTokens) => ({ ...x, ...y }),
      default: () => ({}),
    },
  },
});

workflow
  .addNode('retrieve', retrieveNode)
  .addNode('agent', agentNode)
  .addNode('tools', toolsNode)
  .addEdge(START, 'retrieve')
  .addEdge('retrieve', 'agent')
  .addConditionalEdges('agent', shouldContinue, {
    tools: 'tools',
    [END]: END,
  })
  .addEdge('tools', 'agent');

const compiledGraph = workflow.compile();

export { compiledGraph as graph };
