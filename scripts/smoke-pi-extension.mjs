#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";

const runDir = process.env.GHOSTY_PI_RUN_DIR?.trim() || resolve(homedir(), "runs", "pi-ghosty");
const extPath = resolve(process.cwd(), ".pi", "extensions", "ghosty", "index.ts");
const sessionDir = resolve(runDir, "data", "sessions", "coordinator");
const configPath = process.env.GHOSTY_AGENT_CONFIG_PATH?.trim() || resolve(process.cwd(), "pi-agent-canonical.json");
const configBase = configPath.split(/[\\/]/).pop() || configPath;
const defaultModel = configBase === "pi-agent-local.json" ? "vllm/omnicoder-9b" : "openai-codex/gpt-5.3-codex";
const model = process.env.GHOSTY_PI_SMOKE_MODEL || defaultModel;

const reportDir = resolve(runDir, "data", "delegation-reports");
const existingReports = new Set(
  existsSync(reportDir)
    ? readdirSync(reportDir).filter((name) => name.endsWith(".json"))
    : [],
);

const res = spawnSync(
  "pi",
  ["-p", "--session-dir", sessionDir, "-e", extPath, "--model", model, "/ghosty smoke"],
  {
    encoding: "utf8",
    env: { ...process.env, GHOSTY_AGENT_CONFIG_PATH: configPath, GHOSTY_EXTENSION_ACTIVE: "1" },
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

process.stdout.write(`ok: ${out}\nreport: ${candidateName}\n`);
