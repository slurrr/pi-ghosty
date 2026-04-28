import { z } from "zod";
import { homedir } from "node:os";
import { resolve } from "node:path";

function envBool(defaultValue: boolean) {
  return z.preprocess((value) => {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value !== "string") return value;
    const v = value.trim().toLowerCase();
    if (v === "") return defaultValue;
    if (["1", "true", "yes", "y", "on"].includes(v)) return true;
    if (["0", "false", "no", "n", "off"].includes(v)) return false;
    return value;
  }, z.boolean().default(defaultValue));
}

const workdirModeSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const mode = value.trim().toLowerCase();
  if (["trusted", "no-sandbox", "nosandbox", "unsafe"].includes(mode)) return "trusted";
  if (["sandbox", "safe"].includes(mode)) return "sandbox";
  return value;
}, z.enum(["sandbox", "trusted"]).default("sandbox"));

const envSchema = z.object({
  PROJECT_TAG: z.string().default("project:pi-ghosty"),
  VLLM_BASE_URL: z.string().url().default("http://localhost:8002/v1"),

  HINDSIGHT_BASE_URL: z.string().url().default("http://localhost:8888"),
  HINDSIGHT_BANK_ID: z.string().default("pi-ghosty"),
  HINDSIGHT_PROCEDURAL_BANK_ID: z.string().default("pi-ghosty-procedural"),
  HINDSIGHT_PERSONAL_BANK_ID: z.string().default("pi-ghosty-personal"),

  GHOSTY_PROJECT_DIR: z.string().optional(),
  GHOSTY_WORKDIR_MODE: workdirModeSchema,
  GHOSTY_RUN_DIR: z.string().optional(),

  // Feature toggles
  GHOSTY_DISABLE_MEMORY: envBool(false),

  // Debug flags (all default off / 0)
  GHOSTY_DEBUG_ALL: envBool(false),
  GHOSTY_TRACE_SYSTEM_PROMPT: envBool(false),
  GHOSTY_DEBUG_TOOL_BLOCKS: envBool(false),
  GHOSTY_DEBUG_TOOL_GATING: envBool(false),
  GHOSTY_DEBUG_TOOL_SURFACE: envBool(false),
  GHOSTY_DEBUG_PROMPT_PARTS: envBool(false),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  return envSchema.parse(process.env);
}

function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  return path;
}

export function resolveRunDir(env: Env): string {
  const configured = env.GHOSTY_RUN_DIR?.trim();
  if (configured) return expandHome(configured);
  return resolve(homedir(), "runs", "pi-ghosty");
}

export function resolveWorkDir(env: Env, callerCwd: string, projectDir: string): string {
  return env.GHOSTY_WORKDIR_MODE === "trusted" ? projectDir : callerCwd;
}
