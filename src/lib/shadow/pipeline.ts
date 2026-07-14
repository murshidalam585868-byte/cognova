import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { AppConfig } from '../config';
import { Conversation, UserPreferences } from '../../types';
import { extractPreferencesFromTurn, mergePreferences } from './extract-preferences';
import { storeMemory, storePreferencesSnapshot, queryMemory } from './embed-memory';
import { buildStyleRefiner } from './style-refiner';

/**
 * Shadow Brain — Shadow Pipeline Orchestrator
 * Phase 2: Digital Shadow Self
 *
 * This module is the entry point for the Digital Shadow Self pipeline.
 * It is designed to be invoked after every chat turn (Phase 1 integration).
 *
 * Pipeline Steps:
 * 1. Fetch existing user preferences from Supabase.
 * 2. Extract new preferences from the latest conversation turn via LLM.
 * 3. Merge + persist preferences (Supabase + Pinecone snapshot).
 * 4. Summarize the turn and embed it into Pinecone memory namespace.
 * 5. Query recent memories and build a style refiner prompt for the next turn.
 * 6. Log the run.
 */

// ------------------------------------------------------------------
// Supabase Client Helper
// ------------------------------------------------------------------
function getSupabaseClient(config: AppConfig): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ------------------------------------------------------------------
// Result Type
// ------------------------------------------------------------------
export interface ShadowPipelineResult {
  preferencesUpdated: boolean;
  memoryStored: boolean;
  styleRefiner: string;
  error?: string;
}

// ------------------------------------------------------------------
// Main Pipeline
// ------------------------------------------------------------------
/**
 * Executes the full shadow pipeline for a given user and conversation.
 *
 * @param userId - The authenticated user ID.
 * @param conversation - The conversation object (including the latest turn).
 * @param config - AppConfig.
 * @returns A result object indicating what changed and the generated style refiner.
 */
export async function runShadowPipeline(
  userId: string,
  conversation: Conversation,
  config: AppConfig
): Promise<ShadowPipelineResult> {
  const supabase = getSupabaseClient(config);
  const result: ShadowPipelineResult = {
    preferencesUpdated: false,
    memoryStored: false,
    styleRefiner: '',
  };

  try {
    // --- 1. Load existing user preferences ---
    const { data: profile, error: profileError } = await supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (profileError && profileError.code !== 'PGRST116') {
      // PGRST116 = "Results contain 0 rows" (PostgREST no-row error)
      throw new Error(`Failed to fetch user preferences: ${profileError.message}`);
    }

    const existingPreferences: UserPreferences = profile
      ? {
          tone: profile.tone || 'concise',
          verbosity: profile.verbosity || 'standard',
          responseStyle: profile.response_style || 'collaborative',
          timezone: profile.timezone || 'UTC',
          language: profile.language || 'en',
          topicsOfInterest: profile.topics_of_interest || [],
          industries: profile.industries || [],
        }
      : {
          tone: 'concise',
          verbosity: 'standard',
          responseStyle: 'collaborative',
          timezone: 'UTC',
          language: 'en',
          topicsOfInterest: [],
          industries: [],
        };

    // --- 2. Extract preferences from the conversation ---
    const extracted = await extractPreferencesFromTurn(conversation, config);

    // --- 3. Merge and persist if anything changed ---
    const merged = mergePreferences(existingPreferences, extracted);
    const hasChanged = JSON.stringify(existingPreferences) !== JSON.stringify(merged);

    if (hasChanged) {
      const upsertData = {
        user_id: userId,
        tone: merged.tone,
        verbosity: merged.verbosity,
        response_style: merged.responseStyle,
        timezone: merged.timezone,
        language: merged.language,
        topics_of_interest: merged.topicsOfInterest,
        industries: merged.industries,
        raw_json: merged,
        updated_at: new Date().toISOString(),
      };

      const { error: upsertError } = await supabase
        .from('user_preferences')
        .upsert(upsertData, { onConflict: 'user_id' });

      if (upsertError) {
        throw new Error(`Failed to upsert preferences: ${upsertError.message}`);
      }

      result.preferencesUpdated = true;

      // Also embed the new preference snapshot into Pinecone
      await storePreferencesSnapshot(userId, merged, config);
    }

    // --- 4. Summarize the turn and store in memory ---
    const summary = summarizeConversationTurn(conversation);
    await storeMemory(userId, summary, { conversationId: conversation.id, source: 'chat' }, config);
    result.memoryStored = true;

    // --- 5. Retrieve recent memories to build style refiner ---
    const lastUserMessage = [...conversation.messages]
      .reverse()
      .find((m) => m.role === 'user');
    const query = lastUserMessage ? lastUserMessage.content : 'general context';
    const recentMemories = await queryMemory(userId, query, 5, config);

    result.styleRefiner = buildStyleRefiner(merged, recentMemories);

    // --- 6. Log completion ---
    await supabase.from('shadow_pipeline_runs').insert({
      user_id: userId,
      conversation_id: conversation.id,
      status: 'completed',
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      metadata: {
        preferencesUpdated: result.preferencesUpdated,
        memoryStored: result.memoryStored,
      },
    });

    return result;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    result.error = error;

    // Log failure (best-effort; do not throw here)
    await supabase.from('shadow_pipeline_runs').insert({
      user_id: userId,
      conversation_id: conversation.id,
      status: 'failed',
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      error,
    });

    return result;
  }
}

// ------------------------------------------------------------------
// Phase 1 Integration Hook
// ------------------------------------------------------------------
/**
 * Lightweight integration hook for the Phase 1 chat agent.
 *
 * After the assistant finishes streaming its response and the message is
 * appended to the conversation, call this function to trigger the shadow
 * pipeline asynchronously. It will not block the HTTP response.
 *
 * Example usage in src/app/api/chat/route.ts (after response generation):
 *   await onChatTurnCompleted(userId, updatedConversation, config);
 *
 * @param userId - The authenticated user ID.
 * @param conversation - The updated conversation object.
 * @param config - AppConfig.
 */
export async function onChatTurnCompleted(
  userId: string,
  conversation: Conversation,
  config: AppConfig
): Promise<void> {
  // Fire-and-forget; all errors are caught and logged inside runShadowPipeline
  runShadowPipeline(userId, conversation, config).catch((err) => {
    console.error(
      '[Shadow Pipeline] Unhandled error in onChatTurnCompleted:',
      err
    );
  });
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------
function summarizeConversationTurn(conversation: Conversation): string {
  // Take the last 4 messages (approx. 2 turns) to keep embedding focused
  // while retaining enough conversational context.
  const lastMessages = conversation.messages.slice(-4);
  return lastMessages
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n');
}
