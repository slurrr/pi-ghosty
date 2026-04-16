#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";

const projectDir = process.cwd();
const runDir = process.env.GHOSTY_PI_RUN_DIR?.trim() || resolve(homedir(), "runs", "pi-ghosty-pi");
const extPath = resolve(projectDir, ".pi", "extensions", "ghosty", "index.ts");
const configPath = process.env.GHOSTY_AGENT_CONFIG_PATH?.trim() || resolve(projectDir, "pi-agent-canonical.json");

const args = ["-e", extPath];
if (process.env.GHOSTY_PI_MODEL?.trim()) args.push("--model", process.env.GHOSTY_PI_MODEL.trim());
if (process.env.GHOSTY_PI_SESSION_DIR?.trim()) args.push("--session-dir", process.env.GHOSTY_PI_SESSION_DIR.trim());
else args.push("--session-dir", resolve(runDir, "data", "sessions", "coordinator"));

const res = spawnSync("pi", args, {
  stdio: "inherit",
  env: {
    ...process.env,
    GHOSTY_EXTENSION_ACTIVE: "1",
    GHOSTY_AGENT_CONFIG_PATH: configPath,
    GHOSTY_PI_RUN_DIR: runDir,
  },
});

process.exit(res.status ?? 1);
