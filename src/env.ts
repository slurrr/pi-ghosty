import { z } from "zod";
import { homedir } from "node:os";
import { resolve } from "node:path";

const envSchema = z.object({
  PROJECT_TAG: z.string().default("project:pi-ghosty"),
  VLLM_BASE_URL: z.string().url().default("http://localhost:8002/v1"),

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_ALLOWED_USER_ID: z.coerce.number().int().positive().optional(),

  HINDSIGHT_BASE_URL: z.string().url().default("http://localhost:8888"),
  HINDSIGHT_BANK_ID: z.string().default("pi-ghosty"),

  GHOSTY_RUN_DIR: z.string().optional(),
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
