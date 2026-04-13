#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";

const runDir = process.env.GHOSTY_PI_RUN_DIR?.trim() || resolve(homedir(), "runs", "pi-ghosty-pi");
const extPath = resolve(process.cwd(), ".pi", "extensions", "ghosty", "index.ts");
const sessionDir = resolve(runDir, "data", "sessions", "coordinator");
const model = process.env.GHOSTY_PI_SMOKE_MODEL || "openai-codex/gpt-5.3-codex";
const configPath = process.env.GHOSTY_AGENT_CONFIG_PATH?.trim() || resolve(process.cwd(), "pi-agent.json");

const res = spawnSync(
  "pi",
  ["-p", "--session-dir", sessionDir, "-e", extPath, "--model", model, "/ghosty smoke"],
  {
    encoding: "utf8",
    env: { ...process.env, GHOSTY_AGENT_CONFIG_PATH: configPath },
  },
);

if (res.error) {
  console.error(res.error);
  process.exit(1);
}

if (res.status !== 0) {
  console.error(res.stderr || "(no stderr)");
  process.exit(res.status ?? 1);
}

const out = ((res.stdout && res.stdout.trim()) || (res.stderr && res.stderr.trim()) || "").trim();
if (!out.includes("ghosty smoke:") || !out.includes("smoke test ok")) {
  console.error(`Unexpected output:\n${out}`);
  process.exit(1);
}

process.stdout.write("ok: " + out + "\n");
