#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const runDir = process.env.GHOSTY_PI_RUN_DIR?.trim() || resolve(homedir(), "runs", "pi-ghosty");
const coordinatorSessionId = process.env.GHOSTY_COORDINATOR_SESSION_ID?.trim() || "";
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

function collectJobs() {
  if (!existsSync(jobsRoot)) return [];
  return readdirSync(jobsRoot)
    .map((name) => resolve(jobsRoot, name, "job.json"))
    .map(readJson)
    .filter(Boolean)
    .filter((job) => !coordinatorSessionId || job.coordinatorSessionId === coordinatorSessionId)
    .sort((a, b) => Date.parse(a.launchedAt || "") - Date.parse(b.launchedAt || ""));
}

function renderBoard() {
  const jobs = collectJobs();
  const lines = [];
  lines.push("ghosty delegation board");
  if (coordinatorSessionId) lines.push(`coordinator: ${coordinatorSessionId.slice(0, 8)}`);
  lines.push("");

  if (jobs.length === 0) {
    lines.push("(no delegation jobs yet)");
    return lines.join("\n");
  }

  for (const job of jobs) {
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

    const note = String(job.status?.note || "").trim();
    if (note) tail += `  note:${note.slice(0, 80)}`;
    lines.push(`${phase.padEnd(8, " ")} ${peer} ${shortJob}  ${tail}`);
  }

  return lines.join("\n");
}

async function main() {
  let lastRendered = "";
  while (true) {
    const rendered = `${renderBoard()}\n`;
    if (rendered !== lastRendered) {
      process.stdout.write("\x1bc");
      process.stdout.write(rendered);
      lastRendered = rendered;
    }
    await new Promise((resolve) => setTimeout(resolve, sleepMs));
  }
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
