#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const runDir = process.env.GHOSTY_PI_RUN_DIR?.trim() || resolve(homedir(), "runs", "pi-ghosty");
const jobsRoot = resolve(runDir, "data", "delegation-jobs");
const sleepMs = 1500;

function readJson(path) {
  try {
    const raw = readFileSync(path, "utf8").trim();
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function secondsSince(ts) {
  const ms = Date.parse(ts || "");
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.floor((Date.now() - ms) / 1000));
}

function fmtAge(sec) {
  if (sec === null || sec === undefined) return "-";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return `${m}m${String(s).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h${String(m % 60).padStart(2, "0")}m`;
}

function labelForPhase(phase) {
  switch (phase) {
    case "running":
      return "RUNNING";
    case "launched":
      return "LAUNCHED";
    case "reported":
      return "REPORTED";
    case "missing_report":
      return "MISSING";
    case "exited":
      return "EXITED";
    default:
      return String(phase || "UNKNOWN").toUpperCase();
  }
}

function phaseRank(phase) {
  switch (phase) {
    case "running": return 0;
    case "launched": return 1;
    case "reported": return 2;
    case "missing_report": return 3;
    case "exited": return 4;
    default: return 5;
  }
}

function collectJobs() {
  if (!existsSync(jobsRoot)) return [];
  return readdirSync(jobsRoot)
    .map((name) => resolve(jobsRoot, name, "job.json"))
    .map(readJson)
    .filter(Boolean)
    .sort((a, b) => {
      const phaseCmp = phaseRank(a.status?.phase) - phaseRank(b.status?.phase);
      if (phaseCmp !== 0) return phaseCmp;
      return Date.parse(b.launchedAt || "") - Date.parse(a.launchedAt || "");
    });
}

function renderBoard() {
  const jobs = collectJobs();
  const lines = [];
  lines.push("ghosty delegation board");
  lines.push("");

  if (jobs.length === 0) {
    lines.push("(no delegation jobs yet)");
    return lines.join("\n");
  }

  for (const job of jobs.slice(0, 12)) {
    const phase = labelForPhase(job.status?.phase);
    const peer = String(job.peerName || "?").padEnd(10, " ");
    const shortJob = String(job.jobId || "").slice(0, 8);
    const win = job.tmux?.windowName || job.peerSessionId?.slice(0, 8) || "-";
    const hb = fmtAge(secondsSince(job.status?.heartbeatAt));
    const up = fmtAge(secondsSince(job.status?.startedAt || job.launchedAt));
    const done = fmtAge(secondsSince(job.status?.reportedAt || job.status?.exitedAt));

    let tail = `win:${win}`;
    if (job.status?.phase === "running" || job.status?.phase === "launched") {
      tail += `  hb:${hb}  up:${up}`;
    } else if (job.status?.phase === "reported") {
      tail += `  done:${done} ago`;
    } else if (job.status?.phase === "missing_report" || job.status?.phase === "exited") {
      tail += `  exit:${job.status?.exitStatus ?? "?"}`;
    }

    lines.push(`${phase.padEnd(8, " ")} ${peer} ${shortJob}  ${tail}`);
    if (job.status?.note) {
      lines.push(`          note: ${String(job.status.note).slice(0, 120)}`);
    }
  }

  return lines.join("\n");
}

async function main() {
  while (true) {
    process.stdout.write("\x1bc");
    process.stdout.write(`${renderBoard()}\n`);
    await new Promise((resolve) => setTimeout(resolve, sleepMs));
  }
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
