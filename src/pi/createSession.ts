import { mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  bashTool,
  createAgentSessionFromServices,
  createAgentSessionServices,
  editTool,
  type ExtensionFactory,
  type SessionStartEvent,
  type ToolDefinition,
  findTool,
  grepTool,
  lsTool,
  readTool,
  writeTool,
} from "@mariozechner/pi-coding-agent";
import type { Model } from "@mariozechner/pi-ai";
import { toolGatingExtensionFactory } from "../extensions/toolGatingExtension.js";
import { toolPolicyExtensionFactory } from "../extensions/toolPolicyExtension.js";
import { memoryExtensionFactory } from "../extensions/memoryExtension.js";
import { systemDebugExtensionFactory } from "../extensions/systemDebugExtension.js";
import { explicitPeerAddressingExtensionFactory } from "../extensions/explicitPeerAddressingExtension.js";
import { systemPromptTraceExtensionFactory } from "../extensions/systemPromptTraceExtension.js";
import { JsonlTrace } from "../logging/jsonlTrace.js";
import type { GhostyConfig } from "../config/schema.js";
import type { Env } from "../env.js";
import { loadPeerPromptParts } from "../prompts/loadPeerPromptParts.js";

function buildVllmModel(env: Env, config: GhostyConfig): Model<"openai-completions"> {
  return {
    id: "omnicoder-9b",
    name: "omnicoder-9b (vLLM)",
    api: "openai-completions",
    provider: "vllm",
    baseUrl: env.VLLM_BASE_URL || config.defaults.vllmBaseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: config.defaults.model.contextWindow,
    maxTokens: config.defaults.model.maxTokens,
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
    },
  };
}

function roleFirstSentence(agentName: string): string | undefined {
  if (agentName === "coder") return undefined;
  if (agentName === "coordinator") {
    return (
      "You are the coordinator agent for pi-ghosty and the only user-facing agent. " +
      "Your job is to chat with the user, decide what work to do yourself vs delegate, and delegate focused tasks to specialist peers. " +
      "Integrate peer results into a final answer for the user."
    );
  }
  if (agentName === "researcher") {
    return (
      "You are the researcher peer for pi-ghosty (internal; not user-facing). " +
      "Do local repository/system investigation only and report concise, reproducible findings back to the coordinator."
    );
  }
  if (agentName === "reviewer") {
    return (
      "You are the reviewer peer for pi-ghosty (internal; not user-facing). " +
      "Review proposed changes for correctness, safety, and scope drift, and report concrete issues and a short checklist back to the coordinator."
    );
  }
  if (agentName === "memory") {
    return (
      "You are the memory peer for pi-ghosty (internal; not user-facing). " +
      "Focus on long-term memory behavior (recall/retain, tags, scopes, observations) and report recommendations back to the coordinator."
    );
  }
  return undefined;
}

function overridePiFirstSentence(base: string | undefined, agentName: string): string | undefined {
  if (!base) return base;
  const replacement = roleFirstSentence(agentName);
  if (!replacement) return base;

  const piSentence =
    "You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.";

  if (base.startsWith(piSentence)) {
    return `${replacement}\n\n${base.slice(piSentence.length).trimStart()}`;
  }

  // Fallback if upstream wording changes: keep pi prompt, but lead with our role sentence.
  return `${replacement}\n\n${base}`;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export interface CreateGhostySessionArgs {
  rootDir: string;
  runDir: string;
  env: Env;
  config: GhostyConfig;
  agentName: string;
  customTools?: ToolDefinition[];

  // Optional override to support interactive runtime operations like /new and /resume.
  sessionManager?: SessionManager;
  sessionStartEvent?: SessionStartEvent;
}

export async function createGhostySession(args: CreateGhostySessionArgs) {
  const { rootDir, runDir, env, config, agentName, customTools, sessionManager: sessionManagerOverride, sessionStartEvent } = args;

  const sessionDir = resolve(runDir, "data", "sessions", agentName);
  mkdirSync(sessionDir, { recursive: true });

  const sessionManager = sessionManagerOverride ?? SessionManager.continueRecent(rootDir, sessionDir);
  const settingsManager = SettingsManager.create(runDir);

  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey("vllm", "dummy");
  const modelRegistry = ModelRegistry.create(authStorage);
  // vLLM doesn't require a real key, but pi's AgentSession expects *some* apiKey to be configured.
  modelRegistry.registerProvider("vllm", {
    api: "openai-completions",
    baseUrl: env.VLLM_BASE_URL || config.defaults.vllmBaseUrl,
    apiKey: "dummy",
    authHeader: false,
    models: [
      {
        id: "omnicoder-9b",
        name: "omnicoder-9b (vLLM)",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: config.defaults.model.contextWindow,
        maxTokens: config.defaults.model.maxTokens,
      },
    ],
  } as any);

  const peerParts = loadPeerPromptParts(rootDir, agentName);

  const sessionId = sessionManager.getSessionId();
  const internalAllowedTools = agentName === "coordinator" ? [] : ["peer_report"];
  const debugAll = env.GHOSTY_DEBUG_ALL;
  const traceSystemPrompt = debugAll || env.GHOSTY_TRACE_SYSTEM_PROMPT;
  const traceToolBlocks = debugAll || env.GHOSTY_DEBUG_TOOL_BLOCKS;
  const traceToolGating = traceToolBlocks || env.GHOSTY_DEBUG_TOOL_GATING;

  const extensionFactories: ExtensionFactory[] = [
    ...(traceSystemPrompt
      ? [systemPromptTraceExtensionFactory({ runDir, agentName, sessionId })]
      : []),
    toolPolicyExtensionFactory(
      config,
      agentName,
      sessionId,
      { projectRoot: rootDir, runDir },
      {
        traceCalls: traceToolBlocks,
        traceResults: traceToolBlocks,
        traceBlocks: traceToolBlocks,
      },
    ),
    toolGatingExtensionFactory(config, agentName, internalAllowedTools, {
      runDir,
      sessionId,
      projectTag: config.defaults.projectTag,
      traceBlocks: traceToolGating,
    }),
    ...(env.GHOSTY_DISABLE_MEMORY ? [] : [memoryExtensionFactory(env, config, agentName, sessionId, { runDir })]),
    systemDebugExtensionFactory(),
    explicitPeerAddressingExtensionFactory(agentName),
  ];

  const model = buildVllmModel(env, config);

  const services = await createAgentSessionServices({
    cwd: rootDir,
    settingsManager,
    authStorage,
    modelRegistry,
    resourceLoaderOptions: {
      extensionFactories,
      // Disable automatic AGENTS.md/CLAUDE.md context-file injection.
      // Rationale: our workflow keeps machine/repo contracts out of the LLM system prompt by default.
      agentsFilesOverride: (_current) => ({ agentsFiles: [] }),
      systemPromptOverride: (base) => overridePiFirstSentence(base, agentName),
      appendSystemPromptOverride: (base) => {
        const out = [...base];
        if (peerParts.joined.trim()) out.push(peerParts.joined);
        return out;
      },
    },
  });

  const { session, extensionsResult, modelFallbackMessage } = await createAgentSessionFromServices({
    services,
    sessionManager,
    sessionStartEvent,
    model,
    tools: [readTool, bashTool, editTool, writeTool, grepTool, findTool, lsTool],
    customTools,
  });

  const allowedTools = config.agents[agentName]?.tools ?? [];
  session.setActiveToolsByName([...allowedTools, ...internalAllowedTools]);

  const agentTrace = JsonlTrace.forAgent(runDir, agentName, sessionId);
  if (debugAll || env.GHOSTY_DEBUG_TOOL_SURFACE) {
    await agentTrace.append({
      type: "tool_surface",
      projectTag: config.defaults.projectTag,
      agentName,
      sessionId,
      tools: [...allowedTools, ...internalAllowedTools],
    });
  }
  if (debugAll || env.GHOSTY_DEBUG_PROMPT_PARTS) {
    await agentTrace.append({
      type: "prompt_parts",
      projectTag: config.defaults.projectTag,
      agentName,
      sessionId,
      files: peerParts.files.map((f) => ({
        path: f.path,
        sha256: sha256(f.content),
        length: f.content.length,
      })),
    });
  }

  return { session, sessionManager, services, extensionsResult, modelFallbackMessage };
}
