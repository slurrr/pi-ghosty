import { mkdirSync } from "node:fs";
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
    contextWindow: 32768,
    maxTokens: 8192,
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
    },
  };
}

function roleFirstSentence(agentName: string): string | undefined {
  if (agentName === "coder") return undefined;
  if (agentName === "coordinator") {
    return "You are the coordinator agent for pi-ghosty. You talk to the user and delegate focused work to specialist peers.";
  }
  if (agentName === "researcher") {
    return "You are the researcher peer for pi-ghosty. You do local repository/system research and report concise findings.";
  }
  if (agentName === "reviewer") {
    return "You are the reviewer peer for pi-ghosty. You review changes for correctness, safety, and scope.";
  }
  if (agentName === "memory") {
    return "You are the memory peer for pi-ghosty. You help tune and debug long-term memory behavior and retention.";
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

export interface CreateGhostySessionArgs {
  rootDir: string;
  runDir: string;
  env: Env;
  config: GhostyConfig;
  agentName: string;
  customTools?: ToolDefinition[];
}

export async function createGhostySession(args: CreateGhostySessionArgs) {
  const { rootDir, runDir, env, config, agentName, customTools } = args;

  const sessionDir = resolve(runDir, "data", "sessions", agentName);
  mkdirSync(sessionDir, { recursive: true });

  const sessionManager = SessionManager.continueRecent(rootDir, sessionDir);
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
        contextWindow: 32768,
        maxTokens: 8192,
      },
    ],
  } as any);

  const peerParts = loadPeerPromptParts(rootDir, agentName);

  const sessionId = sessionManager.getSessionId();
  const internalAllowedTools = agentName === "coordinator" ? [] : ["peer_report"];
  const extensionFactories: ExtensionFactory[] = [
    toolPolicyExtensionFactory(config, agentName, sessionId, { projectRoot: rootDir, runDir }),
    toolGatingExtensionFactory(config, agentName, internalAllowedTools),
    memoryExtensionFactory(env, config, agentName, sessionId),
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
    model,
    tools: [readTool, bashTool, editTool, writeTool, grepTool, findTool, lsTool],
    customTools,
  });

  const allowedTools = config.agents[agentName]?.tools ?? [];
  session.setActiveToolsByName([...allowedTools, ...internalAllowedTools]);

  return { session, sessionManager, services, extensionsResult, modelFallbackMessage };
}
