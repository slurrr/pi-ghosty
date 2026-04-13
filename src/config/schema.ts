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

  // Optional default model for this agent/peer.
  // Format: "provider/modelId" (preferred) or "modelId" (uses current provider).
  defaultModel: z.string().min(1).optional(),

  // Provider-specific payload extensions for OpenAI-compatible backends (vLLM).
  // vLLM supports `extra_body` to pass through non-standard fields.
  // We accept both camelCase and snake_case for ergonomics.
  extraBody: z.record(z.string(), z.any()).optional(),
  extra_body: z.record(z.string(), z.any()).optional(),
});

export const extensionAgentConfigSchema = z.object({
  tools: z.array(z.string()).default([]),
  thinkingLevel: thinkingLevelSchema.default("off"),
  defaultModel: z.string().min(1).optional(),
});

const routingSchema = z.object({
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
    routing: routingSchema.optional().default({
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
    }),
  }),
  agents: z.record(z.string(), agentConfigSchema),
});

export const ghostyExtensionConfigSchema = z.object({
  defaults: z.object({
    projectTag: z.string().min(1),
    routing: routingSchema.optional().default({
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
    }),
  }),
  agents: z.record(z.string(), extensionAgentConfigSchema),
});

export type GhostyConfig = z.infer<typeof ghostyConfigSchema>;
export type AgentConfig = z.infer<typeof agentConfigSchema>;
export type GhostyExtensionConfig = z.infer<typeof ghostyExtensionConfigSchema>;
