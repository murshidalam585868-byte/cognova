import { z } from 'zod';

export const FeatureSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  icon: z.string().optional(),
});
export type Feature = z.infer<typeof FeatureSchema>;

export const PricingTierSchema = z.object({
  name: z.string().min(1),
  price: z.string().min(1),
  description: z.string().min(1),
  features: z.array(z.string().min(1)),
  cta: z.string().min(1),
  highlighted: z.boolean().optional(),
});
export type PricingTier = z.infer<typeof PricingTierSchema>;

export const ChatMessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  isStreaming: z.boolean().optional(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const SendMessagePayloadSchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(['user', 'assistant', 'system']),
      content: z.string().min(1),
    })
  ),
  userId: z.string().min(1),
  conversationId: z.string().optional(),
});
export type SendMessagePayload = z.infer<typeof SendMessagePayloadSchema>;
