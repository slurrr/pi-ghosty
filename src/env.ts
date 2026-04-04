import { z } from "zod";

const envSchema = z.object({
  PROJECT_TAG: z.string().default("project:pi-ghosty"),
  VLLM_BASE_URL: z.string().url().default("http://localhost:8002/v1"),

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_ALLOWED_USER_ID: z.coerce.number().int().positive().optional(),

  HINDSIGHT_BASE_URL: z.string().url().default("http://localhost:8888"),
  HINDSIGHT_BANK_ID: z.string().default("pi-ghosty"),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  return envSchema.parse(process.env);
}

