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

export function loadConfigFromFile(configPath: string): GhostyConfig {
  const raw = readFileSync(configPath, "utf-8");
  const json = JSON.parse(raw) as unknown;
  return ghostyConfigSchema.parse(json);
}

export function loadExtensionConfigFromFile(configPath: string): GhostyExtensionConfig {
  const raw = readFileSync(configPath, "utf-8");
  const json = JSON.parse(raw) as unknown;
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
