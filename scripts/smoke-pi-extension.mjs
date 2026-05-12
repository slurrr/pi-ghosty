#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";

const runDir = process.env.GHOSTY_PI_RUN_DIR?.trim() || resolve(homedir(), "runs", "pi-ghosty");
const extPath = resolve(process.cwd(), ".pi", "extensions", "ghosty", "index.ts");
const defaultSessionDir = resolve(runDir, "data", "sessions-smoke", "corroborator");
const sessionDir = process.env.GHOSTY_PI_SMOKE_SESSION_DIR?.trim() || defaultSessionDir;
const envConfigPath = process.env.GHOSTY_AGENT_CONFIG_PATH?.trim();
const fallbackConfigPath = resolve(process.cwd(), "pi-agent.json");
const configPath = envConfigPath && existsSync(resolve(process.cwd(), envConfigPath)) ? envConfigPath : fallbackConfigPath;
const defaultModel = "openai-codex/gpt-5.4-mini";
const model = process.env.GHOSTY_PI_SMOKE_MODEL || defaultModel;

const reportDir = resolve(runDir, "data", "delegation-reports");
const existingReports = new Set(
  existsSync(reportDir)
    ? readdirSync(reportDir).filter((name) => name.endsWith(".json"))
    : [],
);

const timeoutMsRaw = Number(process.env.GHOSTY_PI_SMOKE_TIMEOUT_MS);
const timeoutMs = Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0 ? Math.trunc(timeoutMsRaw) : 120_000;

function getAuthPath() {
  const agentDir = process.env.PI_CODING_AGENT_DIR?.trim() || resolve(homedir(), ".pi", "agent");
  return resolve(agentDir, "auth.json");
}

function hasAuthForProvider(providerId) {
  // env var auth (subset; only what we might smoke with)
  const envMap = {
    openai: "OPENAI_API_KEY",
    "openai-codex": "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    google: "GEMINI_API_KEY",
    mistral: "MISTRAL_API_KEY",
    groq: "GROQ_API_KEY",
  };

  const envVar = envMap[providerId];
  if (envVar && process.env[envVar]) return { ok: true, source: `env:${envVar}` };

  // auth.json (api_key or oauth)
  try {
    const authPath = getAuthPath();
    if (!existsSync(authPath)) return { ok: false, reason: `missing ${authPath}` };
    const raw = readFileSync(authPath, "utf8");
    const data = raw.trim() ? JSON.parse(raw) : {};
    const cred = data?.[providerId];
    if (cred && (cred.type === "api_key" || cred.type === "oauth")) return { ok: true, source: `auth.json:${providerId}:${cred.type}` };
    return { ok: false, reason: `no credentials for ${providerId} in auth.json` };
  } catch (err) {
    return { ok: false, reason: `failed to read auth.json (${err?.message ?? String(err)})` };
  }
}

const providerId = String(model.split("/")[0] || "").trim();
if (providerId && providerId !== "vllm") {
  const authCheck = hasAuthForProvider(providerId);
  if (!authCheck.ok) {
    console.error(
      `Smoke test has no auth configured for provider ${providerId} (model ${model}).\n` +
        `Reason: ${authCheck.reason}\n` +
        `Fix: run \`pi /login\` (for OAuth providers) or set the provider env var / add credentials to auth.json.\n` +
        `Or override model via GHOSTY_PI_SMOKE_MODEL.`,
    );
    process.exit(2);
  }
}

const res = spawnSync(
  "pi",
  ["-p", "--session-dir", sessionDir, "-e", extPath, "--model", model, "/ghosty smoke"],
  {
    encoding: "utf8",
    env: { ...process.env, GHOSTY_AGENT_CONFIG_PATH: configPath, GHOSTY_EXTENSION_ACTIVE: "1" },
    timeout: timeoutMs,
    killSignal: "SIGKILL",
  },
);

let timedOut = false;
if (res.error) {
  const err = res.error;
  // spawnSync uses code=ETIMEDOUT when timeout triggers.
  if (err && (err.code === "ETIMEDOUT" || err.message?.includes("timed out"))) {
    timedOut = true;
  } else {
    console.error(err);
    process.exit(1);
  }
}

if (!timedOut && res.status !== 0) {
  console.error(res.stderr || "(no stderr)");
  process.exit(res.status ?? 1);
}

const out = ((res.stdout && res.stdout.trim()) || (res.stderr && res.stderr.trim()) || "").trim();

const reportNames = existsSync(reportDir)
  ? readdirSync(reportDir).filter((name) => name.endsWith(".json"))
  : [];
const newReports = reportNames.filter((name) => !existingReports.has(name));
const candidateName = (newReports.sort().at(-1) ?? reportNames.sort().at(-1));
if (!candidateName) {
  console.error(`No delegation report found in ${reportDir}`);
  process.exit(1);
}

const candidatePath = resolve(reportDir, candidateName);
const report = JSON.parse(readFileSync(candidatePath, "utf8"));
const filePattern = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z-[a-z]+-[0-9a-f-]+\.json$/;
if (!filePattern.test(candidateName)) {
  console.error(`Unexpected delegation report filename: ${candidateName}`);
  process.exit(1);
}
if (basename(report.reportPath || "") !== candidateName) {
  console.error(`Report path mismatch for ${candidateName}: ${report.reportPath || "(missing)"}`);
  process.exit(1);
}
if (report.title !== `${report.peerName}-${report.jobId}`) {
  console.error(`Report title mismatch for ${candidateName}`);
  process.exit(1);
}
if (!report.delegationMessage || !report.delegationMessage.includes("Delegation job:")) {
  console.error(`Report missing delegationMessage/job metadata for ${candidateName}`);
  process.exit(1);
}
if (!report.output || report.output.summary !== "smoke test ok") {
  console.error(`Unexpected delegation report summary for ${candidateName}`);
  process.exit(1);
}
if (report.peerName !== "researcher" || report.reportSource !== "tool") {
  console.error(`Unexpected delegation report fields for ${candidateName}`);
  process.exit(1);
}

if (!timedOut && (!out.includes("ghosty smoke:") || !out.includes("smoke test ok"))) {
  console.error(`Unexpected output:\n${out}`);
  process.exit(1);
}

const statusLine = timedOut
  ? `ok: corroborator stayed active past timeout, but delegation report completed successfully`
  : `ok: ${out}`;
process.stdout.write(`${statusLine}\nreport: ${candidateName}\n`);
