/**
 * src/lib/db/supabase.ts
 * Supabase client singleton and database operations for Shadow Brain.
 * Handles conversations, messages, memories, tasks, and tool configs.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { loadConfig } from '@/lib/config';
import { logger } from '@/lib/logger';
import type {
  Conversation,
  Message,
  UserProfile,
  MemoryEntry,
  Task,
} from '@/types';

// ---------------------------------------------------------------------------
// Client Initialization
// ---------------------------------------------------------------------------

let supabase: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (supabase) return supabase;

  const config = loadConfig();
  if (!config.supabaseUrl || !config.supabaseServiceKey) {
    throw new Error('Supabase URL and Service Role Key must be configured.');
  }

  supabase = createClient(config.supabaseUrl, config.supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return supabase;
}

// ---------------------------------------------------------------------------
// Conversation Operations
// ---------------------------------------------------------------------------

export async function createConversation(
  userId: string,
  title = 'New Conversation'
): Promise<Conversation> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('conversations')
    .insert({ user_id: userId, title })
    .select()
    .single();

  if (error) {
    logger.error('Failed to create conversation', { error, userId });
    throw new Error(`DB error: ${error.message}`);
  }

  return mapConversation(data);
}

export async function getConversation(conversationId: string): Promise<Conversation | null> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('conversations')
    .select('*')
    .eq('id', conversationId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // no rows
    logger.error('Failed to get conversation', { error, conversationId });
    throw new Error(`DB error: ${error.message}`);
  }

  return mapConversation(data);
}

export async function getConversationsByUser(userId: string): Promise<Conversation[]> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('conversations')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error) {
    logger.error('Failed to list conversations', { error, userId });
    throw new Error(`DB error: ${error.message}`);
  }

  return (data || []).map(mapConversation);
}

export async function updateConversationTitle(
  conversationId: string,
  title: string
): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb
    .from('conversations')
    .update({ title })
    .eq('id', conversationId);

  if (error) {
    logger.error('Failed to update conversation title', { error, conversationId });
    throw new Error(`DB error: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Message Operations
// ---------------------------------------------------------------------------

export async function saveMessage(
  conversationId: string,
  message: Omit<Message, 'id' | 'createdAt'>
): Promise<Message> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('messages')
    .insert({
      conversation_id: conversationId,
      role: message.role,
      content: message.content,
      metadata: message.metadata ?? {},
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to save message', { error, conversationId });
    throw new Error(`DB error: ${error.message}`);
  }

  return mapMessage(data);
}

export async function getMessagesByConversation(conversationId: string): Promise<Message[]> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (error) {
    logger.error('Failed to get messages', { error, conversationId });
    throw new Error(`DB error: ${error.message}`);
  }

  return (data || []).map(mapMessage);
}

// ---------------------------------------------------------------------------
// User Profile Operations
// ---------------------------------------------------------------------------

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('user_profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    logger.error('Failed to get user profile', { error, userId });
    throw new Error(`DB error: ${error.message}`);
  }

  return mapUserProfile(data);
}

export async function upsertUserProfile(
  profile: Partial<UserProfile> & { id: string; email: string }
): Promise<UserProfile> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('user_profiles')
    .upsert({
      id: profile.id,
      email: profile.email,
      name: profile.name ?? '',
      preferences: profile.preferences ?? {},
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to upsert user profile', { error, userId: profile.id });
    throw new Error(`DB error: ${error.message}`);
  }

  return mapUserProfile(data);
}

// ---------------------------------------------------------------------------
// Memory Operations
// ---------------------------------------------------------------------------

export async function saveMemory(
  userId: string,
  namespace: string,
  content: string,
  metadata: Record<string, unknown> = {}
): Promise<MemoryEntry> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('memories')
    .insert({ user_id: userId, namespace, content, metadata })
    .select()
    .single();

  if (error) {
    logger.error('Failed to save memory', { error, userId });
    throw new Error(`DB error: ${error.message}`);
  }

  return mapMemoryEntry(data);
}

export async function getMemoriesByUser(
  userId: string,
  namespace?: string
): Promise<MemoryEntry[]> {
  const sb = getSupabaseClient();
  let query = sb.from('memories').select('*').eq('user_id', userId);
  if (namespace) {
    query = query.eq('namespace', namespace);
  }
  const { data, error } = await query.order('created_at', { ascending: false });

  if (error) {
    logger.error('Failed to get memories', { error, userId });
    throw new Error(`DB error: ${error.message}`);
  }

  return (data || []).map(mapMemoryEntry);
}

// ---------------------------------------------------------------------------
// Task Operations
// ---------------------------------------------------------------------------

export async function createTask(
  type: string,
  payload: Record<string, unknown>
): Promise<Task> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('tasks')
    .insert({ type, payload })
    .select()
    .single();

  if (error) {
    logger.error('Failed to create task', { error, type });
    throw new Error(`DB error: ${error.message}`);
  }

  return mapTask(data);
}

export async function updateTaskStatus(
  taskId: string,
  status: Task['status'],
  result?: Record<string, unknown>,
  errorMessage?: string
): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb
    .from('tasks')
    .update({ status, result, error_message: errorMessage })
    .eq('id', taskId);

  if (error) {
    logger.error('Failed to update task', { error, taskId });
    throw new Error(`DB error: ${error.message}`);
  }
}

export async function getPendingTasks(limit = 100): Promise<Task[]> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('tasks')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    logger.error('Failed to get pending tasks', { error });
    throw new Error(`DB error: ${error.message}`);
  }

  return (data || []).map(mapTask);
}

// ---------------------------------------------------------------------------
// Tool Config Operations
// ---------------------------------------------------------------------------

export async function getToolConfig(userId: string, toolName: string) {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('tool_configs')
    .select('*')
    .eq('user_id', userId)
    .eq('tool_name', toolName)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    logger.error('Failed to get tool config', { error, userId, toolName });
    throw new Error(`DB error: ${error.message}`);
  }

  return data;
}

export async function upsertToolConfig(
  userId: string,
  toolName: string,
  tokens: { accessToken?: string; refreshToken?: string; expiresAt?: Date },
  config: Record<string, unknown> = {}
): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.from('tool_configs').upsert({
    user_id: userId,
    tool_name: toolName,
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    token_expires_at: tokens.expiresAt?.toISOString() ?? null,
    config,
  });

  if (error) {
    logger.error('Failed to upsert tool config', { error, userId, toolName });
    throw new Error(`DB error: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapConversation(row: Record<string, unknown>): Conversation {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    title: String(row.title),
    messages: [],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapMessage(row: Record<string, unknown>): Message {
  return {
    id: String(row.id),
    role: row.role as Message['role'],
    content: String(row.content),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: String(row.created_at),
  };
}

function mapUserProfile(row: Record<string, unknown>): UserProfile {
  return {
    id: String(row.id),
    email: String(row.email),
    name: String(row.name),
    preferences: (row.preferences as UserProfile['preferences']) ?? {
      tone: 'detailed',
      verbosity: 'standard',
      responseStyle: 'collaborative',
      timezone: 'UTC',
      language: 'en',
      topicsOfInterest: [],
      industries: [],
    },
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapMemoryEntry(row: Record<string, unknown>): MemoryEntry {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    namespace: String(row.namespace),
    content: String(row.content),
    embedding: (row.embedding as number[]) ?? [],
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: String(row.created_at),
  };
}

function mapTask(row: Record<string, unknown>): Task {
  return {
    id: String(row.id),
    type: String(row.type),
    status: row.status as Task['status'],
    payload: (row.payload as Record<string, unknown>) ?? {},
    result: (row.result as Record<string, unknown>) ?? undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
