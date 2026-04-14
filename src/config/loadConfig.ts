import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ghostyConfigSchema, type GhostyConfig, type RequestRule } from "./schema.js";

const DEFAULT_CANONICAL_CONFIG_PATH = "pi-agent-canonical.json";
const DEFAULT_RUNTIME_CONFIG_PATH = "pi-agent-local.json";
const DEFAULT_EXTENSION_CONFIG_PATH = "pi-agent-frontier.json";
const LEGACY_CONFIG_PATH = "pi-agent.json";

function resolveFirstExisting(rootDir: string, candidates: string[]): string {
  for (const candidate of candidates) {
    const path = resolve(rootDir, candidate);
    if (existsSync(path)) return path;
  }
  return resolve(rootDir, candidates[0]);
}

function normalizeShorthandRequestRules(json: any): RequestRule[] {
  const defaults = json?.defaults ?? {};
  const agents = json?.agents ?? {};
  const rules: RequestRule[] = [];

  if (defaults?.sampling) {
    rules.push({
      when: { model: ["vllm/*"] },
      apply: { sampling: defaults.sampling },
    });
  }

  for (const [agentName, agent] of Object.entries<any>(agents)) {
    const apply: any = {};
    if (agent?.sampling) apply.sampling = agent.sampling;
    if (agent?.extraBody) apply.extraBody = agent.extraBody;
    if (agent?.extra_body) apply.extra_body = agent.extra_body;
    if (Object.keys(apply).length === 0) continue;
    rules.push({
      when: { agent: [agentName], model: ["vllm/*"] },
      apply,
    });
  }

  return rules;
}

function normalizeConfigJson(json: any): GhostyConfig {
  const defaults = json?.defaults ?? {};
  const agents = json?.agents ?? {};
  const runtime = defaults.runtime ?? ((defaults.vllmBaseUrl || defaults.hindsightBaseUrl || defaults.hindsightBankId || defaults.model)
    ? {
        vllmBaseUrl: defaults.vllmBaseUrl,
        hindsightBaseUrl: defaults.hindsightBaseUrl,
        hindsightBankId: defaults.hindsightBankId,
        model: defaults.model,
      }
    : undefined);

  const shorthandRules = normalizeShorthandRequestRules(json);
  const explicitRules = Array.isArray(json?.requestRules) ? json.requestRules : [];
  const routing = json?.routing ?? { defaults: defaults.routing ?? undefined, budgetGuards: {} };

  return ghostyConfigSchema.parse({
    defaults: {
      projectTag: defaults.projectTag,
      runtime,
    },
    agents: Object.fromEntries(
      Object.entries<any>(agents).map(([name, agent]) => [
        name,
        {
          tools: agent?.tools ?? [],
          thinkingLevel: agent?.thinkingLevel ?? "off",
          defaultModel: agent?.defaultModel,
        },
      ]),
    ),
    requestRules: [...shorthandRules, ...explicitRules],
    routing: {
      defaults: routing?.defaults ?? {},
      budgetGuards: routing?.budgetGuards ?? {},
    },
    routingRules: Array.isArray(json?.routingRules) ? json.routingRules : [],
    modelScopePresets: json?.modelScopePresets ?? {},
  });
}

export function loadConfigFromFile(configPath: string): GhostyConfig {
  const raw = readFileSync(configPath, "utf-8");
  const json = JSON.parse(raw) as unknown;
  return normalizeConfigJson(json as any);
}

export function loadExtensionConfigFromFile(configPath: string): GhostyConfig {
  return loadConfigFromFile(configPath);
}

export function loadConfig(rootDir: string): GhostyConfig {
  const path = resolveFirstExisting(rootDir, [
    DEFAULT_CANONICAL_CONFIG_PATH,
    DEFAULT_RUNTIME_CONFIG_PATH,
    DEFAULT_EXTENSION_CONFIG_PATH,
    LEGACY_CONFIG_PATH,
  ]);
  return loadConfigFromFile(path);
}

export function loadExtensionConfig(rootDir: string): GhostyConfig {
  const path = resolveFirstExisting(rootDir, [
    DEFAULT_CANONICAL_CONFIG_PATH,
    DEFAULT_EXTENSION_CONFIG_PATH,
    DEFAULT_RUNTIME_CONFIG_PATH,
    LEGACY_CONFIG_PATH,
  ]);
  return loadExtensionConfigFromFile(path);
}
