#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const runDir = process.env.GHOSTY_RUN_DIR
  ? (process.env.GHOSTY_RUN_DIR.startsWith("~")
      ? resolve(homedir(), process.env.GHOSTY_RUN_DIR.slice(1))
      : resolve(process.env.GHOSTY_RUN_DIR))
  : resolve(homedir(), "runs", "pi-ghosty");

const pidPath = resolve(runDir, "ghosty.pid");

let pid;
try {
  pid = parseInt(readFileSync(pidPath, "utf-8").trim(), 10);
} catch (err) {
  console.error(`No pidfile at ${pidPath} (is pi-ghosty running?)`);
  process.exit(1);
}

if (!Number.isFinite(pid) || pid <= 1) {
  console.error(`Invalid pid in ${pidPath}: ${pid}`);
  process.exit(1);
}

try {
  process.kill(pid, "SIGINT");
  console.log(`Sent SIGINT to pi-ghosty pid ${pid} (from ${pidPath})`);
} catch (err) {
  console.error(`Failed to signal pid ${pid}: ${err?.message ?? String(err)}`);
  process.exit(1);
}
