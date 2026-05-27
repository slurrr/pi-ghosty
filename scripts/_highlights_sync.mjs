import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

export function syncHindsightHighlights({ banks, baseUrl }) {
  const highlightsDir = process.env.HINDSIGHT_HIGHLIGHTS_DIR?.trim()
    ? resolve(process.env.HINDSIGHT_HIGHLIGHTS_DIR.trim())
    : resolve(process.cwd(), "../hindsight-highlights");

  if (!existsSync(highlightsDir)) return;

  const args = [
    "run",
    "python",
    "scripts/pull_banks.py",
    "--base-url",
    baseUrl,
    "--banks",
    ...banks,
  ];

  const res = spawnSync("uv", args, {
    cwd: highlightsDir,
    stdio: "inherit",
    env: process.env,
  });

  if (res.status !== 0) {
    throw new Error(`hindsight-highlights pull failed (exit=${res.status})`);
  }
}
