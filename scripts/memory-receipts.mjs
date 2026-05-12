#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      out._.push(a);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i++;
  }
  return out;
}

function usage() {
  return [
    "ghosty memory receipts",
    "",
    "usage:",
    "  npm run -s memory -- --agent corroborator --last 5",
    "  npm run -s memory -- --all",
    "  npm run -s memory -- --agent coder --full",
    "",
    "flags:",
    "  --runDir <path>     (default: $GHOSTY_PI_RUN_DIR or ~/runs/pi-ghosty)",
    "  --agent <name>      (corroborator|coder|researcher|reviewer|memory)",
    "  --all               show latest per agent",
    "  --last <n>          show last n receipts (default 1)",
    "  --full              include full injected block when available",
  ].join("\n");
}

function safeReadJson(path) {
  try {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, "utf8");
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function listDirs(path) {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

function mostRecentSessionDir(agentDir) {
  const sessions = listDirs(agentDir);
  let best = null;
  let bestTs = 0;
  for (const s of sessions) {
    const latestPath = resolve(agentDir, s, "latest.json");
    const latest = safeReadJson(latestPath);
    const ts = latest?.ts ? Date.parse(latest.ts) : 0;
    if (ts > bestTs) {
      bestTs = ts;
      best = resolve(agentDir, s);
    }
  }
  return best;
}

function renderSummary(latest) {
  const injectedLines = latest?.injectedLines ?? 0;
  const injectedChars = latest?.injectedChars ?? 0;
  const factsCount = latest?.factsCount ?? null;
  const ms = latest?.recallMs ?? null;
  const retain = latest?.retain?.status ?? "unknown";
  return `ts=${latest?.ts ?? "?"} recallMs=${ms ?? "?"} facts=${factsCount ?? "?"} injectedLines=${injectedLines} chars=${injectedChars} retain=${retain}`;
}

function printLatest(sessionDir, { full }) {
  const latest = safeReadJson(resolve(sessionDir, "latest.json"));
  if (!latest) return "(no latest.json)";

  const turnDir = latest.turnDir ? resolve(sessionDir, latest.turnDir) : null;
  const injectedPath = turnDir ? resolve(turnDir, "injected.md") : resolve(sessionDir, "latest-injected.md");
  const injected = existsSync(injectedPath) ? readFileSync(injectedPath, "utf8") : "(missing injected block)";

  if (full) {
    return [
      `${latest.agentName}@${latest.sessionId}`,
      renderSummary(latest),
      "",
      injected.trimEnd(),
    ].join("\n");
  }

  const lines = injected.split(/\r?\n/).filter(Boolean);
  const head = lines.slice(0, 12).join("\n");
  const more = lines.length > 12 ? `\n… (${lines.length - 12} more lines, use --full)` : "";
  return [
    `${latest.agentName}@${latest.sessionId}`,
    renderSummary(latest),
    "",
    head + more,
  ].join("\n");
}

function listTurns(sessionDir) {
  const turnsDir = resolve(sessionDir, "turns");
  const turns = listDirs(turnsDir).sort();
  return turns.map((t) => resolve(turnsDir, t));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage() + "\n");
    process.exit(0);
  }

  const runDir = args.runDir ? resolve(String(args.runDir)) : (process.env.GHOSTY_PI_RUN_DIR?.trim() || resolve(homedir(), "runs", "pi-ghosty"));
  const root = resolve(runDir, "data", "memory", "receipts");

  const full = !!args.full;
  const lastRaw = Number(args.last);
  const lastN = Number.isFinite(lastRaw) && lastRaw > 0 ? Math.min(50, Math.trunc(lastRaw)) : 1;

  if (args.all) {
    const agents = listDirs(root).sort();
    if (agents.length === 0) {
      process.stdout.write(`no receipts found at ${root}\n`);
      process.exit(1);
    }

    const blocks = [];
    for (const agentName of agents) {
      const agentDir = resolve(root, agentName);
      const sessionDir = mostRecentSessionDir(agentDir);
      if (!sessionDir) {
        blocks.push(`${agentName}: (no sessions)`);
        continue;
      }
      blocks.push(printLatest(sessionDir, { full }));
      blocks.push("\n---\n");
    }

    process.stdout.write(blocks.join("\n").trimEnd() + "\n");
    return;
  }

  const agent = String(args.agent || "corroborator");
  const agentDir = resolve(root, agent);
  const sessionDir = mostRecentSessionDir(agentDir);
  if (!sessionDir) {
    process.stdout.write(`no receipts for agent ${agent} under ${agentDir}\n`);
    process.exit(1);
  }

  if (lastN === 1) {
    process.stdout.write(printLatest(sessionDir, { full }) + "\n");
    return;
  }

  const turns = listTurns(sessionDir).slice(-lastN);
  const blocks = [];
  for (const turnDir of turns) {
    const injectedPath = resolve(turnDir, "injected.md");
    const injected = existsSync(injectedPath) ? readFileSync(injectedPath, "utf8") : "(missing injected block)";
    const meta = safeReadJson(resolve(turnDir, "meta.json")) || {};
    const header = `${agent}@${meta.sessionId || "?"} turn=${meta.turnId || "?"} ts=${meta.ts || "?"}`;

    if (full) {
      blocks.push([header, "", injected.trimEnd(), "\n---\n"].join("\n"));
    } else {
      const lines = injected.split(/\r?\n/).filter(Boolean);
      const head = lines.slice(0, 12).join("\n");
      const more = lines.length > 12 ? `\n… (${lines.length - 12} more lines, use --full)` : "";
      blocks.push([header, "", head + more, "\n---\n"].join("\n"));
    }
  }
  process.stdout.write(blocks.join("\n").trimEnd() + "\n");
}

main();
