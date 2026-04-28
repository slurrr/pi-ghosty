import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { SettingsManager } from "@mariozechner/pi-coding-agent";

export function projectSettingsPath(projectDir: string): string {
  return resolve(projectDir, ".pi", "settings.json");
}

export function readProjectSettings(projectDir: string): Record<string, unknown> {
  const path = projectSettingsPath(projectDir);
  if (!existsSync(path)) return {};

  const raw = readFileSync(path, "utf-8");
  if (!raw.trim()) return {};

  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }

  return parsed as Record<string, unknown>;
}

export function writeProjectSettings(projectDir: string, settings: Record<string, unknown>): void {
  const path = projectSettingsPath(projectDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`, "utf-8");
}

function normalizePattern(pattern: string): string {
  return String(pattern ?? "").trim().toLowerCase();
}

function isLocalProviderPattern(pattern: string): boolean {
  return normalizePattern(pattern).startsWith("vllm/");
}

function uniqueStrings(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = String(value ?? "").trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

export function readGlobalEnabledModels(projectDir: string): string[] {
  try {
    const settings = SettingsManager.create(projectDir);
    const raw = settings.getGlobalSettings().enabledModels;
    return Array.isArray(raw) ? uniqueStrings(raw.map((p) => String(p))) : [];
  } catch {
    return [];
  }
}

export function resolveProjectPresetEnabledModels(
  projectDir: string,
  presetName: string,
  fallbackPatterns: string[],
): string[] {
  const globalPatterns = readGlobalEnabledModels(projectDir);
  const source = globalPatterns.length > 0 ? globalPatterns : fallbackPatterns;
  const frontier = source.filter((pattern) => !isLocalProviderPattern(pattern));
  const local = source.filter((pattern) => isLocalProviderPattern(pattern));
  const fallbackFrontier = fallbackPatterns.filter((pattern) => !isLocalProviderPattern(pattern));
  const fallbackLocal = fallbackPatterns.filter((pattern) => isLocalProviderPattern(pattern));

  switch (presetName) {
    case "frontier-only":
      return uniqueStrings(frontier.length > 0 ? frontier : fallbackFrontier);
    case "local-only":
      return uniqueStrings(local.length > 0 ? local : fallbackLocal);
    case "frontier-preferred":
      return uniqueStrings([
        ...(frontier.length > 0 ? frontier : fallbackFrontier),
        ...(local.length > 0 ? local : fallbackLocal),
      ]);
    case "local-preferred":
      return uniqueStrings([
        ...(local.length > 0 ? local : fallbackLocal),
        ...(frontier.length > 0 ? frontier : fallbackFrontier),
      ]);
    case "hybrid-default":
      return uniqueStrings([
        ...(frontier.length > 0 ? frontier : fallbackFrontier),
        ...(local.length > 0 ? local : fallbackLocal),
      ]);
    default:
      return uniqueStrings(fallbackPatterns);
  }
}

export function setProjectEnabledModels(projectDir: string, patterns: string[] | undefined): void {
  const settings = readProjectSettings(projectDir);
  if (patterns && patterns.length > 0) {
    settings.enabledModels = [...patterns];
  } else {
    delete settings.enabledModels;
  }
  writeProjectSettings(projectDir, settings);
}
