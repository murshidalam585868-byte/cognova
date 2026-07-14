/**
 * src/lib/learning/skill-discovery.ts
 * Continuous Learning — Skill Discovery Engine
 *
 * Analyzes conversation history, tool usage, user requests, and feedback patterns
 * to identify new skills or capabilities the user needs. Generates skill
 * recommendations with confidence scores, evidence, and implementation notes.
 */

import { z } from 'zod';
import { getSupabaseClient } from '@/lib/db/supabase';
import { logger } from '@/lib/logger';
import { loadConfig } from '@/lib/config';
import type { Conversation, DiscoveredSkill, Message } from '@/types';

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

export const SkillDiscoveryInputSchema = z.object({
  userId: z.string().uuid(),
  lookbackDays: z.number().int().min(1).max(365).default(30),
  minConfidence: z.number().min(0).max(1).default(0.6),
  maxResults: z.number().int().min(1).max(100).default(20),
  categories: z.array(z.string()).optional(),
});
export type SkillDiscoveryInput = z.infer<typeof SkillDiscoveryInputSchema>;

export const SkillEvaluateInputSchema = z.object({
  skillId: z.string().uuid(),
  status: z.enum(['evaluated', 'implemented', 'rejected']),
  implementationNotes: z.string().max(5000).optional(),
});
export type SkillEvaluateInput = z.infer<typeof SkillEvaluateInputSchema>;

// ---------------------------------------------------------------------------
// Core Operations
// ---------------------------------------------------------------------------

/**
 * Analyze recent conversations for unmet skill needs.
 * Uses LLM-based analysis of user requests, frustrations, and tool gaps.
 */
export async function discoverSkills(input: SkillDiscoveryInput): Promise<DiscoveredSkill[]> {
  const validated = SkillDiscoveryInputSchema.parse(input);
  const sb = getSupabaseClient();

  const since = new Date();
  since.setDate(since.getDate() - validated.lookbackDays);

  // Fetch recent conversations
  const { data: convs, error: convErr } = await sb
    .from('conversations')
    .select('*')
    .eq('user_id', validated.userId)
    .gte('updated_at', since.toISOString())
    .order('updated_at', { ascending: false })
    .limit(20);

  if (convErr) {
    logger.error('Failed to fetch conversations for skill discovery', { error: convErr });
    throw new Error(`DB error: ${convErr.message}`);
  }

  // Hydrate with messages
  const conversations: Conversation[] = [];
  for (const raw of convs ?? []) {
    const { data: msgs, error: msgErr } = await sb
      .from('messages')
      .select('*')
      .eq('conversation_id', String(raw.id))
      .order('created_at', { ascending: true });

    if (msgErr) continue;

    conversations.push({
      id: String(raw.id),
      userId: String(raw.user_id),
      title: String(raw.title),
      messages: (msgs ?? []).map((m) => ({
        id: String(m.id),
        role: m.role as Message['role'],
        content: String(m.content),
        metadata: (m.metadata as Record<string, unknown>) ?? {},
        createdAt: String(m.created_at),
      })),
      createdAt: String(raw.created_at),
      updatedAt: String(raw.updated_at),
    });
  }

  if (conversations.length === 0) {
    return [];
  }

  // LLM-based skill discovery
  const discovered = await analyzeConversationsForSkills(conversations, validated.userId, validated.minConfidence);

  // Filter by category if specified
  let filtered = discovered;
  if (validated.categories && validated.categories.length > 0) {
    filtered = discovered.filter((s) => validated.categories!.includes(s.category));
  }

  // Deduplicate against existing discovered skills
  const existing = await getDiscoveredSkills(validated.userId, { status: 'discovered' });
  const existingNames = new Set(existing.map((s) => s.name.toLowerCase()));
  const deduplicated = filtered.filter((s) => !existingNames.has(s.name.toLowerCase()));

  // Persist new discoveries
  const saved: DiscoveredSkill[] = [];
  for (const skill of deduplicated.slice(0, validated.maxResults)) {
    try {
      const persisted = await saveDiscoveredSkill(skill);
      saved.push(persisted);
    } catch (err) {
      logger.warn('Failed to save discovered skill', {
        error: err instanceof Error ? err.message : String(err),
        skillName: skill.name,
      });
    }
  }

  logger.info('Skill discovery completed', {
    userId: validated.userId,
    discovered: saved.length,
    analyzed: conversations.length,
  });

  return saved;
}

/**
 * Get discovered skills for a user with optional filtering.
 */
export async function getDiscoveredSkills(
  userId: string,
  opts?: { status?: DiscoveredSkill['status']; category?: string; limit?: number; offset?: number }
): Promise<DiscoveredSkill[]> {
  const sb = getSupabaseClient();
  let query = sb
    .from('discovered_skills')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (opts?.status) query = query.eq('status', opts.status);
  if (opts?.category) query = query.eq('category', opts.category);
  if (opts?.limit) query = query.limit(opts.limit);
  if (opts?.offset) query = query.range(opts.offset, opts.offset + (opts.limit ?? 10) - 1);

  const { data, error } = await query;

  if (error) {
    logger.error('Failed to get discovered skills', { error, userId });
    throw new Error(`DB error: ${error.message}`);
  }

  return (data ?? []).map(mapDiscoveredSkill);
}

/**
 * Get a single discovered skill by ID.
 */
export async function getDiscoveredSkillById(skillId: string): Promise<DiscoveredSkill | null> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('discovered_skills')
    .select('*')
    .eq('id', skillId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    logger.error('Failed to get discovered skill', { error, skillId });
    throw new Error(`DB error: ${error.message}`);
  }

  return mapDiscoveredSkill(data);
}

/**
 * Evaluate or update the status of a discovered skill.
 */
export async function evaluateSkill(input: SkillEvaluateInput): Promise<DiscoveredSkill> {
  const validated = SkillEvaluateInputSchema.parse(input);
  const sb = getSupabaseClient();

  const patch: Record<string, unknown> = {
    status: validated.status,
    updated_at: new Date().toISOString(),
  };
  if (validated.implementationNotes) {
    patch.implementation_notes = validated.implementationNotes;
  }

  const { data, error } = await sb
    .from('discovered_skills')
    .update(patch)
    .eq('id', validated.skillId)
    .select()
    .single();

  if (error) {
    logger.error('Failed to evaluate skill', { error, skillId: validated.skillId });
    throw new Error(`DB error: ${error.message}`);
  }

  logger.info('Skill evaluated', { skillId: validated.skillId, status: validated.status });
  return mapDiscoveredSkill(data);
}

/**
 * Mark a skill as implemented (convenience wrapper).
 */
export async function markSkillAsImplemented(
  skillId: string,
  notes?: string
): Promise<DiscoveredSkill> {
  return evaluateSkill({ skillId, status: 'implemented', implementationNotes: notes });
}

/**
 * Get skill recommendations ranked by priority and confidence.
 */
export async function getSkillRecommendations(
  userId: string,
  limit = 5
): Promise<DiscoveredSkill[]> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('discovered_skills')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'discovered')
    .order('priority', { ascending: false })
    .order('confidence', { ascending: false })
    .limit(limit);

  if (error) {
    logger.error('Failed to get skill recommendations', { error, userId });
    throw new Error(`DB error: ${error.message}`);
  }

  return (data ?? []).map(mapDiscoveredSkill);
}

// ---------------------------------------------------------------------------
// LLM Analysis
// ---------------------------------------------------------------------------

async function analyzeConversationsForSkills(
  conversations: Conversation[],
  userId: string,
  minConfidence: number
): Promise<DiscoveredSkill[]> {
  const config = loadConfig();

  // Build a condensed analysis transcript
  const transcript = conversations
    .map((c) => {
      const userMessages = c.messages
        .filter((m) => m.role === 'user')
        .map((m) => m.content.slice(0, 300))
        .join('\n');
      const assistantMessages = c.messages
        .filter((m) => m.role === 'assistant')
        .map((m) => m.content.slice(0, 150))
        .join('\n');
      return `CONVERSATION: ${c.title}\nUSER:\n${userMessages}\nASSISTANT:\n${assistantMessages}`;
    })
    .join('\n\n---\n\n')
    .slice(0, 6000);

  const systemPrompt = `You are a skill discovery analyst for an AI CEO Office assistant.

Analyze the provided conversation history and identify unmet skill needs, capability gaps, or features the user implicitly or explicitly requests.

For each discovered skill, return an object with:
- name: short skill name (2-5 words)
- description: what this skill does and why the user needs it (1-2 sentences)
- category: one of [analytics, communication, automation, research, integration, strategy, productivity, security, finance, other]
- priority: "low" | "medium" | "high" | "critical"
- confidence: 0.0-1.0 (how certain you are this is a real need)
- evidence: array of 1-3 short quotes from the user showing the need

Return ONLY a JSON object: { "skills": [...] }. Omit any skill with confidence below ${minConfidence}.`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: transcript },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.4,
        max_tokens: 1200,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const json = await response.json();
    const raw = json.choices?.[0]?.message?.content;
    const parsed = JSON.parse(raw);
    const skills = Array.isArray(parsed.skills) ? parsed.skills : [];

    return skills
      .filter((s: unknown) => {
        const conf = (s as Record<string, unknown>).confidence ?? 0;
        return typeof conf === 'number' && conf >= minConfidence;
      })
      .map((s: unknown) => buildDiscoveredSkill(s as Record<string, unknown>, userId))
      .filter(Boolean) as DiscoveredSkill[];
  } catch (err) {
    logger.error('Skill discovery LLM analysis failed', {
      error: err instanceof Error ? err.message : String(err),
      userId,
    });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildDiscoveredSkill(raw: Record<string, unknown>, userId: string): DiscoveredSkill | null {
  const name = String(raw.name ?? '').trim();
  if (!name) return null;

  const evidence = Array.isArray(raw.evidence)
    ? raw.evidence.map((e) => String(e)).filter(Boolean)
    : [];

  return {
    id: crypto.randomUUID(),
    userId,
    name,
    description: String(raw.description ?? ''),
    evidence,
    category: String(raw.category ?? 'other'),
    priority: (raw.priority as DiscoveredSkill['priority']) ?? 'medium',
    status: 'discovered',
    confidence: Math.min(1, Math.max(0, Number(raw.confidence ?? 0.5))),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function saveDiscoveredSkill(skill: DiscoveredSkill): Promise<DiscoveredSkill> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('discovered_skills')
    .insert({
      id: skill.id,
      user_id: skill.userId,
      name: skill.name,
      description: skill.description,
      evidence: skill.evidence,
      category: skill.category,
      priority: skill.priority,
      status: skill.status,
      confidence: skill.confidence,
      created_at: skill.createdAt,
      updated_at: skill.updatedAt,
    })
    .select()
    .single();

  if (error) {
    // Duplicate name check (unique constraint)
    if (error.code === '23505') {
      logger.info('Duplicate skill discovered, skipping', { name: skill.name });
      return skill;
    }
    throw new Error(`DB error: ${error.message}`);
  }

  return mapDiscoveredSkill(data);
}

function mapDiscoveredSkill(row: Record<string, unknown>): DiscoveredSkill {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    name: String(row.name ?? ''),
    description: String(row.description ?? ''),
    evidence: (row.evidence as string[]) ?? [],
    category: String(row.category ?? 'other'),
    priority: (row.priority as DiscoveredSkill['priority']) ?? 'medium',
    status: (row.status as DiscoveredSkill['status']) ?? 'discovered',
    implementationNotes: row.implementation_notes ? String(row.implementation_notes) : undefined,
    confidence: Number(row.confidence ?? 0.5),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
