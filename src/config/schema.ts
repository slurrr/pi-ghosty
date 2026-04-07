import { z } from "zod";

const thinkingLevelSchema = z.enum(["off", "minimal", "low", "medium", "high", "xhigh"]).default("off");

export const agentConfigSchema = z.object({
  tools: z.array(z.string()).default([]),
  thinkingLevel: thinkingLevelSchema.default("off"),
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
  }),
  agents: z.record(z.string(), agentConfigSchema),
});

export type GhostyConfig = z.infer<typeof ghostyConfigSchema>;
export type AgentConfig = z.infer<typeof agentConfigSchema>;
