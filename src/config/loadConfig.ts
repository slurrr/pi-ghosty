import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ghostyConfigSchema, type GhostyConfig } from "./schema.js";

export function loadConfig(rootDir: string): GhostyConfig {
  const path = resolve(rootDir, "pi-agent.json");
  const raw = readFileSync(path, "utf-8");
  const json = JSON.parse(raw) as unknown;
  return ghostyConfigSchema.parse(json);
}

