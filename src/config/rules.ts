import type { GhostyConfig, RequestRule, RequestRuleApply, RoutingConfig, RoutingRule, RoutingRuleApply } from "./schema.js";

export interface ModelRef {
  provider: string;
  id: string;
}

function stripThinkingSuffix(value: string): string {
  const text = String(value || "").trim();
  const i = text.lastIndexOf(":");
  if (i < 0) return text;
  const suffix = text.slice(i + 1).toLowerCase();
  if (!["off", "minimal", "low", "medium", "high", "xhigh"].includes(suffix)) return text;
  return text.slice(0, i).trim();
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regex = `^${escaped.replaceAll("*", ".*").replaceAll("?", ".")}$`;
  return new RegExp(regex, "i");
}

function globMatches(pattern: string, value: string): boolean {
  if (!pattern.trim() || !value.trim()) return false;
  return globToRegex(pattern).test(value);
}

export function modelKey(model: ModelRef | null | undefined): string {
  if (!model) return "";
  return `${String(model.provider).toLowerCase()}/${stripThinkingSuffix(String(model.id)).toLowerCase()}`;
}

function modelMatchesPattern(model: ModelRef, pattern: string): boolean {
  const normalizedPattern = stripThinkingSuffix(pattern);
  const providerScopedId = modelKey(model);
  const idOnly = stripThinkingSuffix(String(model.id));
  return globMatches(normalizedPattern, providerScopedId) || globMatches(normalizedPattern, idOnly);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function deepMerge<T>(base: T, override: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(override)) return (override as T) ?? base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(override)) {
    if (k in out) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out as T;
}

function requestRuleMatches(rule: RequestRule, agentName: string, model: ModelRef | null | undefined): boolean {
  const agentPatterns = rule.when.agent ?? [];
  const modelPatterns = rule.when.model ?? [];

  if (agentPatterns.length > 0 && !agentPatterns.includes(agentName)) return false;
  if (modelPatterns.length > 0) {
    if (!model) return false;
    if (!modelPatterns.some((p) => modelMatchesPattern(model, p))) return false;
  }

  return true;
}

function mergeRequestRuleApply(base: RequestRuleApply, apply: RequestRuleApply): RequestRuleApply {
  const out: RequestRuleApply = { ...base };
  if (apply.sampling) out.sampling = deepMerge(out.sampling ?? {}, apply.sampling);
  const extraBody = apply.extraBody ?? apply.extra_body;
  if (extraBody) out.extra_body = deepMerge((out.extraBody ?? out.extra_body ?? {}) as Record<string, unknown>, extraBody) as any;
  return out;
}

export function resolveRequestRuleApply(config: GhostyConfig, agentName: string, model: ModelRef | null | undefined): RequestRuleApply {
  let out: RequestRuleApply = {};
  for (const rule of config.requestRules) {
    if (!requestRuleMatches(rule, agentName, model)) continue;
    out = mergeRequestRuleApply(out, rule.apply);
  }
  return out;
}

function routingRuleMatches(rule: RoutingRule, model: ModelRef | null | undefined): boolean {
  const modelPatterns = rule.when.model ?? [];
  if (modelPatterns.length > 0) {
    if (!model) return false;
    if (!modelPatterns.some((p) => modelMatchesPattern(model, p))) return false;
  }
  return true;
}

function mergeRoutingApply(base: RoutingConfig["defaults"], apply: RoutingRuleApply): RoutingConfig["defaults"] {
  const out = { ...base };
  for (const [key, value] of Object.entries(apply)) {
    if (value === undefined) continue;
    if (key === "semantic") {
      out.semantic = { ...out.semantic, ...(value as any) };
      continue;
    }
    (out as any)[key] = value;
  }
  return out;
}

export function resolveRoutingDefaults(config: GhostyConfig, model: ModelRef | null | undefined): RoutingConfig["defaults"] {
  let out = { ...config.routing.defaults, semantic: { ...config.routing.defaults.semantic } };
  for (const rule of config.routingRules) {
    if (!routingRuleMatches(rule, model)) continue;
    out = mergeRoutingApply(out, rule.apply);
  }
  return out;
}
