import { z } from "zod";

const thinkingLevelSchema = z.enum(["off", "minimal", "low", "medium", "high", "xhigh"]).default("off");
const penaltySchema = z.union([z.number().min(-2).max(2), z.null()]);

export const samplingSchema = z.object({
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().gt(0).max(1).optional(),
  topK: z.union([z.literal(-1), z.number().int().min(1), z.null()]).optional(),
  minP: z.number().min(0).max(1).optional(),
  repetitionPenalty: z.number().min(1).optional(),
  presencePenalty: penaltySchema.optional(),
  frequencyPenalty: penaltySchema.optional(),
});

export const runtimeDefaultsSchema = z.object({
  vllmBaseUrl: z.string().url(),
  hindsightBaseUrl: z.string().url(),
  hindsightBankId: z.string().min(1),
  model: z.object({
    contextWindow: z.number().int().positive(),
    maxTokens: z.number().int().positive(),
  }),
});

export const agentConfigSchema = z.object({
  tools: z.array(z.string()).default([]),
  thinkingLevel: thinkingLevelSchema.default("off"),
  defaultModel: z.string().min(1).optional(),
});

export const requestRuleApplySchema = z.object({
  sampling: samplingSchema.optional(),
  extraBody: z.record(z.string(), z.any()).optional(),
  extra_body: z.record(z.string(), z.any()).optional(),
});

export const requestRuleSchema = z.object({
  when: z.object({
    agent: z.array(z.string()).optional(),
    model: z.array(z.string()).optional(),
  }),
  apply: requestRuleApplySchema,
});

export const routingDefaultsSchema = z.object({
  maxParallelDelegations: z.number().int().positive().default(2),
  maxNumSeqHint: z.number().int().positive().default(4),
  maxLoadedSessionsTotal: z.number().int().positive().default(8),
  maxLoadedSessionsPerPeer: z.number().int().positive().default(4),
  compactThresholdPercent: z.number().min(0).max(100).default(75),
  retireAfterCompactions: z.number().int().nonnegative().default(5),
  semantic: z.object({
    enabled: z.literal(true).default(true),
    updateCooldownMs: z.number().int().nonnegative().default(3600000),
    maxCandidates: z.number().int().positive().default(8),
    model: z.string().default("default"),
  }).default({
    enabled: true,
    updateCooldownMs: 3600000,
    maxCandidates: 8,
    model: "default",
  }),
}).default({
  maxParallelDelegations: 2,
  maxNumSeqHint: 4,
  maxLoadedSessionsTotal: 8,
  maxLoadedSessionsPerPeer: 4,
  compactThresholdPercent: 75,
  retireAfterCompactions: 5,
  semantic: {
    enabled: true,
    updateCooldownMs: 3600000,
    maxCandidates: 8,
    model: "default",
  },
});

export const budgetGuardsSchema = z.object({
  maxDelegationsPerUserTurn: z.number().int().positive().optional(),
  maxNewSessionsPerUserTurn: z.number().int().positive().optional(),
  maxFrontierDelegationsPerUserTurn: z.number().int().positive().optional(),
}).default({});

export const routingRuleApplySchema = z.object({
  maxParallelDelegations: z.number().int().positive().optional(),
  maxNumSeqHint: z.number().int().positive().optional(),
  maxLoadedSessionsTotal: z.number().int().positive().optional(),
  maxLoadedSessionsPerPeer: z.number().int().positive().optional(),
  compactThresholdPercent: z.number().min(0).max(100).optional(),
  retireAfterCompactions: z.number().int().nonnegative().optional(),
  semantic: z.object({
    enabled: z.literal(true).optional(),
    updateCooldownMs: z.number().int().nonnegative().optional(),
    maxCandidates: z.number().int().positive().optional(),
    model: z.string().optional(),
  }).optional(),
});

export const routingRuleSchema = z.object({
  when: z.object({
    model: z.array(z.string()).optional(),
  }),
  apply: routingRuleApplySchema,
});

export const routingConfigSchema = z.object({
  defaults: routingDefaultsSchema.default(routingDefaultsSchema.parse({})),
  budgetGuards: budgetGuardsSchema.default({}),
});

export const ghostyConfigSchema = z.object({
  defaults: z.object({
    projectTag: z.string().min(1),
    runtime: runtimeDefaultsSchema.optional(),
  }),
  agents: z.record(z.string(), agentConfigSchema),
  requestRules: z.array(requestRuleSchema).default([]),
  routing: routingConfigSchema.default({ defaults: routingDefaultsSchema.parse({}), budgetGuards: {} }),
  routingRules: z.array(routingRuleSchema).default([]),
  modelScopePresets: z.record(z.string(), z.array(z.string())).default({}),
});

export type GhostyConfig = z.infer<typeof ghostyConfigSchema>;
export type AgentConfig = z.infer<typeof agentConfigSchema>;
export type SamplingConfig = z.infer<typeof samplingSchema>;
export type RequestRule = z.infer<typeof requestRuleSchema>;
export type RequestRuleApply = z.infer<typeof requestRuleApplySchema>;
export type RoutingRule = z.infer<typeof routingRuleSchema>;
export type RoutingRuleApply = z.infer<typeof routingRuleApplySchema>;
export type RoutingConfig = z.infer<typeof routingConfigSchema>;
