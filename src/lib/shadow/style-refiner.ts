import { UserPreferences, MemoryEntry } from '../../types';

/**
 * Shadow Brain — Style Refiner
 * Phase 2: Digital Shadow Self
 *
 * Builds a dynamic system-prompt section that adapts the assistant's tone,
 * verbosity, response style, and topical focus to the individual user.
 */

/**
 * Constructs a style refiner prompt from the user's preferences and
 * recent memory context.
 *
 * @param preferences - The merged user preferences.
 * @param recentMemories - Up to 5 recent or semantically relevant memories.
 * @returns A markdown-formatted prompt block intended for injection into
 *          the assistant's system prompt.
 */
export function buildStyleRefiner(
  preferences: UserPreferences,
  recentMemories: MemoryEntry[]
): string {
  const sections: string[] = [];

  sections.push(`# Shadow Brain — Style Refiner`);
  sections.push(
    `You are a personalized AI business partner. The following profile and context guide your responses so they align with the user's preferences, tone, and recent interests.`
  );

  sections.push(`## User Profile`);
  sections.push(`- **Tone:** ${preferences.tone}`);
  sections.push(`- **Verbosity:** ${preferences.verbosity}`);
  sections.push(`- **Response Style:** ${preferences.responseStyle}`);
  sections.push(`- **Language:** ${preferences.language}`);
  sections.push(`- **Timezone:** ${preferences.timezone}`);

  if (preferences.topicsOfInterest.length > 0) {
    sections.push(`\n## Topics of Interest`);
    sections.push(preferences.topicsOfInterest.map((t) => `- ${t}`).join('\n'));
  }

  if (preferences.industries.length > 0) {
    sections.push(`\n## Industries`);
    sections.push(preferences.industries.map((i) => `- ${i}`).join('\n'));
  }

  if (recentMemories.length > 0) {
    sections.push(`\n## Recent Context`);
    sections.push(
      recentMemories
        .slice(0, 5)
        .map((m) => `- ${m.content}`)
        .join('\n')
    );
  }

  sections.push(`\n## Response Guidelines`);
  sections.push(`1. Match the user's **tone** and **verbosity** in every reply.`);
  sections.push(`2. Use their **timezone** when referencing dates or scheduling.`);
  sections.push(`3. Prioritize content related to their **topics of interest** and **industries**.`);
  sections.push(`4. Apply their **response style** (e.g., Socratic = ask guiding questions; Directive = give clear instructions).`);
  sections.push(`5. If uncertain about preference, ask a brief clarifying question in the user's preferred style.`);
  sections.push(`6. Maintain consistency with the **Recent Context** above.`);

  return sections.join('\n');
}

/**
 * Injects the style refiner into a base system prompt.
 *
 * @param baseSystemPrompt - The original system prompt (e.g., from Phase 1 agent).
 * @param preferences - The user's preferences.
 * @param recentMemories - Recent memories for context.
 * @returns A combined system prompt string.
 */
export function injectStyleRefiner(
  baseSystemPrompt: string,
  preferences: UserPreferences,
  recentMemories: MemoryEntry[]
): string {
  const refiner = buildStyleRefiner(preferences, recentMemories);
  return `${baseSystemPrompt}\n\n${refiner}`;
}
