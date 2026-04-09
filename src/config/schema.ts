import { z } from "zod";

const thinkingLevelSchema = z.enum(["off", "minimal", "low", "medium", "high", "xhigh"]).default("off");

const penaltySchema = z.union([z.number().min(-2).max(2), z.null()]);

const samplingSchema = z.object({
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().gt(0).max(1).optional(),
  topK: z.union([z.literal(-1), z.number().int().min(1), z.null()]).optional(),
  minP: z.number().min(0).max(1).optional(),
  repetitionPenalty: z.number().min(1).optional(),
  presencePenalty: penaltySchema.optional(),
  frequencyPenalty: penaltySchema.optional(),
});

export const agentConfigSchema = z.object({
  tools: z.array(z.string()).default([]),
  thinkingLevel: thinkingLevelSchema.default("off"),
  sampling: samplingSchema.optional(),
});

export const ghostyConfigSchema = z.object({
  defaults: z.object({
    vllmBaseUrl: z.string().url(),
    hindsightBaseUrl: z.string().url(),
    hindsightBankId: z.string().min(1),
    projectTag: z.string().min(1),
    model: z.object({
      contextWindow: z.number().int().positive(),
      maxTokens: z.number().int().positive(),
    }),
    sampling: samplingSchema.optional(),
  }),
  agents: z.record(z.string(), agentConfigSchema),
});

export type GhostyConfig = z.infer<typeof ghostyConfigSchema>;
export type AgentConfig = z.infer<typeof agentConfigSchema>;
