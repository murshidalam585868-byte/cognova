import { z } from 'zod';
import { AppConfig } from '../config';
import { Conversation, UserPreferences } from '../../types';

/**
 * Shadow Brain — Preference Extraction Engine
 * Phase 2: Digital Shadow Self
 *
 * Extracts structured user preferences from conversation transcripts using
 * an LLM (OpenAI GPT-4o-mini). The output is validated with Zod and merged
 * into the existing UserPreferences shape.
 */

// ------------------------------------------------------------------
// Zod Schema for LLM output
// ------------------------------------------------------------------
export const ExtractedPreferencesSchema = z
  .object({
    tone: z.enum(['concise', 'detailed', 'technical', 'casual']).optional(),
    verbosity: z.enum(['minimal', 'standard', 'verbose']).optional(),
    responseStyle: z.enum(['directive', 'socratic', 'collaborative']).optional(),
    timezone: z.string().optional(),
    language: z.string().optional(),
    topicsOfInterest: z.array(z.string()).optional(),
    industries: z.array(z.string()).optional(),
  })
  .partial();

export type ExtractedPreferences = z.infer<typeof ExtractedPreferencesSchema>;

// ------------------------------------------------------------------
// Prompt Engineering
// ------------------------------------------------------------------
const SYSTEM_PROMPT = `You are a user preference extraction engine for an AI business partner.

Analyze the provided conversation transcript and extract any stated or implied preferences about the user's communication style, interests, and context.

Return ONLY a JSON object with camelCase keys. Do not wrap the JSON in markdown code blocks. Omit any field that is not present in the transcript.

Allowed fields:
- tone: "concise" | "detailed" | "technical" | "casual"
- verbosity: "minimal" | "standard" | "verbose"
- responseStyle: "directive" | "socratic" | "collaborative"
- timezone: any valid IANA timezone string (e.g., "America/New_York")
- language: ISO 639-1 code (e.g., "en", "zh")
- topicsOfInterest: array of topic strings
- industries: array of industry strings

Examples of valid output:
{"tone":"technical","verbosity":"minimal","industries":["fintech"]}
{"tone":"casual","responseStyle":"collaborative","topicsOfInterest":["marketing","startups"]}`;

function buildExtractionPrompt(conversation: Conversation): string {
  // Use the last 6 messages (~3 turns) to stay within token limits while
  // capturing enough context for preference extraction.
  const recent = conversation.messages.slice(-6);
  const transcript = recent
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n');

  return `Extract user preferences from the following transcript.\n\n${transcript}`;
}

// ------------------------------------------------------------------
// Core Extraction
// ------------------------------------------------------------------
/**
 * Extracts preferences from the most recent turn(s) of a conversation.
 *
 * @param conversation - The conversation object containing messages.
 * @param config - AppConfig with OpenAI API key.
 * @returns A partial UserPreferences object with only extracted fields.
 */
export async function extractPreferencesFromTurn(
  conversation: Conversation,
  config: AppConfig
): Promise<Partial<UserPreferences>> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.openaiApiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildExtractionPrompt(conversation) },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 512,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${text}`);
  }

  const json = await response.json();
  const rawContent = json.choices?.[0]?.message?.content;
  if (!rawContent) {
    throw new Error('Empty response from OpenAI preference extraction');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    throw new Error(`Invalid JSON from OpenAI: ${rawContent}`);
  }

  const validated = ExtractedPreferencesSchema.parse(parsed);

  // Map validated shape to UserPreferences
  const preferences: Partial<UserPreferences> = {};
  if (validated.tone) preferences.tone = validated.tone;
  if (validated.verbosity) preferences.verbosity = validated.verbosity;
  if (validated.responseStyle) preferences.responseStyle = validated.responseStyle;
  if (validated.timezone) preferences.timezone = validated.timezone;
  if (validated.language) preferences.language = validated.language;
  if (validated.topicsOfInterest) preferences.topicsOfInterest = validated.topicsOfInterest;
  if (validated.industries) preferences.industries = validated.industries;

  return preferences;
}

// ------------------------------------------------------------------
// Merge Logic
// ------------------------------------------------------------------
/**
 * Merges newly extracted preferences into the existing profile.
 * Arrays are deduplicated. Scalar fields are overwritten only when the
 * extracted value is defined.
 */
export function mergePreferences(
  existing: UserPreferences,
  extracted: Partial<UserPreferences>
): UserPreferences {
  return {
    tone: extracted.tone ?? existing.tone,
    verbosity: extracted.verbosity ?? existing.verbosity,
    responseStyle: extracted.responseStyle ?? existing.responseStyle,
    timezone: extracted.timezone ?? existing.timezone,
    language: extracted.language ?? existing.language,
    topicsOfInterest: mergeArrays(existing.topicsOfInterest, extracted.topicsOfInterest),
    industries: mergeArrays(existing.industries, extracted.industries),
  };
}

function mergeArrays(a: string[], b?: string[]): string[] {
  if (!b || b.length === 0) return a;
  return [...new Set([...a, ...b])];
}
