#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectDir = process.env.GHOSTY_PROJECT_DIR?.trim()
  ? resolve(process.cwd(), process.env.GHOSTY_PROJECT_DIR.trim())
  : resolve(scriptDir, "..");

const callerCwd = process.cwd();
const rawMode = process.env.GHOSTY_WORKDIR_MODE?.trim().toLowerCase();
const workdirMode = ["trusted", "no-sandbox", "nosandbox", "unsafe"].includes(rawMode || "") ? "trusted" : "sandbox";
const launchCwd = workdirMode === "trusted" ? projectDir : callerCwd;

const runDir = process.env.GHOSTY_PI_RUN_DIR?.trim() || resolve(homedir(), "runs", "pi-ghosty");
const extPath = resolve(projectDir, ".pi", "extensions", "ghosty", "index.ts");
const configPath = process.env.GHOSTY_AGENT_CONFIG_PATH?.trim() || resolve(projectDir, "pi-agent-canonical.json");

const args = ["-e", extPath];
if (process.env.GHOSTY_PI_MODEL?.trim()) args.push("--model", process.env.GHOSTY_PI_MODEL.trim());
if (process.env.GHOSTY_PI_SESSION_DIR?.trim()) args.push("--session-dir", process.env.GHOSTY_PI_SESSION_DIR.trim());
else args.push("--session-dir", resolve(runDir, "data", "sessions", "coordinator"));

const res = spawnSync("pi", args, {
  stdio: "inherit",
  cwd: launchCwd,
  env: {
    ...process.env,
    GHOSTY_EXTENSION_ACTIVE: "1",
    GHOSTY_PROJECT_DIR: projectDir,
    GHOSTY_WORKDIR_MODE: workdirMode,
    GHOSTY_AGENT_CONFIG_PATH: configPath,
    GHOSTY_PI_RUN_DIR: runDir,
  },
});

process.exit(res.status ?? 1);
