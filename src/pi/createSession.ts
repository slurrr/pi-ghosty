import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  AuthStorage,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  bashTool,
  createAgentSession,
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
import { memoryExtensionFactory } from "../extensions/memoryExtension.js";
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

export interface CreateGhostySessionArgs {
  rootDir: string;
  env: Env;
  config: GhostyConfig;
  agentName: string;
  customTools?: ToolDefinition[];
}

export async function createGhostySession(args: CreateGhostySessionArgs) {
  const { rootDir, env, config, agentName, customTools } = args;

  const sessionDir = resolve(rootDir, "data", "sessions", agentName);
  mkdirSync(sessionDir, { recursive: true });

  const sessionManager = SessionManager.continueRecent(rootDir, sessionDir);
  const settingsManager = SettingsManager.create(rootDir);

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

  const extensionFactories: ExtensionFactory[] = [
    toolGatingExtensionFactory(config, agentName),
    memoryExtensionFactory(env, config, agentName, sessionManager.getSessionId()),
  ];

  const resourceLoader = new DefaultResourceLoader({
    cwd: rootDir,
    settingsManager,
    extensionFactories,
    appendSystemPromptOverride: (base) => {
      const out = [...base];
      if (peerParts.joined.trim()) out.push(peerParts.joined);
      return out;
    },
  });
  await resourceLoader.reload();

  const model = buildVllmModel(env, config);

  const { session } = await createAgentSession({
    cwd: rootDir,
    model,
    tools: [readTool, bashTool, editTool, writeTool, grepTool, findTool, lsTool],
    customTools,
    resourceLoader,
    sessionManager,
    settingsManager,
    modelRegistry,
  });

  const allowedTools = config.agents[agentName]?.tools ?? [];
  session.setActiveToolsByName(allowedTools);

  return { session, sessionManager };
}
