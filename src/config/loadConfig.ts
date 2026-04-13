import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ghostyConfigSchema,
  ghostyExtensionConfigSchema,
  type GhostyConfig,
  type GhostyExtensionConfig,
} from "./schema.js";

const DEFAULT_RUNTIME_CONFIG_PATH = "pi-agent-local.json";
const DEFAULT_EXTENSION_CONFIG_PATH = "pi-agent-frontier.json";
const LEGACY_CONFIG_PATH = "pi-agent.json";

function configBasename(configPath: string): string {
  return configPath.split(/[\\/]/).pop() ?? configPath;
}

function assertRuntimeConfigPath(configPath: string) {
  const base = configBasename(configPath);
  if (base === DEFAULT_EXTENSION_CONFIG_PATH) {
    throw new Error(`Runtime ghosty must load ${DEFAULT_RUNTIME_CONFIG_PATH}, not ${DEFAULT_EXTENSION_CONFIG_PATH}: ${configPath}`);
  }
}

function assertExtensionConfigPath(configPath: string) {
  const base = configBasename(configPath);
  if (base === DEFAULT_RUNTIME_CONFIG_PATH) {
    throw new Error(`Ghosty Pi extension must load ${DEFAULT_EXTENSION_CONFIG_PATH}, not ${DEFAULT_RUNTIME_CONFIG_PATH}: ${configPath}`);
  }
}

function assertExtensionConfigShape(json: unknown, configPath: string) {
  const root = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const defaults = (root.defaults && typeof root.defaults === "object" ? root.defaults : {}) as Record<string, unknown>;
  const agents = (root.agents && typeof root.agents === "object" ? root.agents : {}) as Record<string, unknown>;

  const runtimeDefaultKeys = ["vllmBaseUrl", "hindsightBaseUrl", "hindsightBankId", "model", "sampling"];
  const badDefaultKey = runtimeDefaultKeys.find((key) => Object.prototype.hasOwnProperty.call(defaults, key));
  if (badDefaultKey) {
    throw new Error(
      `Ghosty Pi extension config cannot include runtime-only defaults.${badDefaultKey}; use ${DEFAULT_EXTENSION_CONFIG_PATH} for extension runs and ${DEFAULT_RUNTIME_CONFIG_PATH} for local runtime runs: ${configPath}`,
    );
  }

  for (const [agentName, value] of Object.entries(agents)) {
    if (!value || typeof value !== "object") continue;
    const agent = value as Record<string, unknown>;
    const badAgentKey = ["sampling", "extraBody", "extra_body"].find((key) => Object.prototype.hasOwnProperty.call(agent, key));
    if (badAgentKey) {
      throw new Error(
        `Ghosty Pi extension config cannot include runtime-only agents.${agentName}.${badAgentKey}; use ${DEFAULT_EXTENSION_CONFIG_PATH} for extension runs and ${DEFAULT_RUNTIME_CONFIG_PATH} for local runtime runs: ${configPath}`,
      );
    }
  }
}

export function loadConfigFromFile(configPath: string): GhostyConfig {
  assertRuntimeConfigPath(configPath);
  const raw = readFileSync(configPath, "utf-8");
  const json = JSON.parse(raw) as unknown;
  return ghostyConfigSchema.parse(json);
}

export function loadExtensionConfigFromFile(configPath: string): GhostyExtensionConfig {
  assertExtensionConfigPath(configPath);
  const raw = readFileSync(configPath, "utf-8");
  const json = JSON.parse(raw) as unknown;
  assertExtensionConfigShape(json, configPath);
  return ghostyExtensionConfigSchema.parse(json);
}

function resolveFirstExisting(rootDir: string, candidates: string[]): string {
  for (const candidate of candidates) {
    const path = resolve(rootDir, candidate);
    if (existsSync(path)) return path;
  }
  return resolve(rootDir, candidates[0]);
}

export function loadConfig(rootDir: string): GhostyConfig {
  const path = resolveFirstExisting(rootDir, [DEFAULT_RUNTIME_CONFIG_PATH, LEGACY_CONFIG_PATH]);
  return loadConfigFromFile(path);
}

export function loadExtensionConfig(rootDir: string): GhostyExtensionConfig {
  const path = resolveFirstExisting(rootDir, [DEFAULT_EXTENSION_CONFIG_PATH, LEGACY_CONFIG_PATH]);
  return loadExtensionConfigFromFile(path);
}
