#!/usr/bin/env node

import { HindsightClient } from "@vectorize-io/hindsight-client";
import { syncHindsightHighlights } from "./_highlights_sync.mjs";

const VALID_MODES = new Set(["concise", "verbose", "verbatim", "chunks", "custom"]);

function usage(exitCode = 1) {
  console.error(`Usage:
  node scripts/set-retain-extraction-mode.mjs <mode> [custom instructions...]

Modes:
  concise   Selective; only facts worth remembering long-term
  verbose   More detail per fact; slower, uses more tokens
  verbatim  Store chunks as-is, with LLM metadata extraction
  chunks    Store chunks as-is, zero LLM fact extraction cost
  custom    Replace built-in extraction rules entirely; requires custom instructions

Environment:
  HINDSIGHT_BASE_URL   Defaults to http://localhost:8888
  HINDSIGHT_BANK_ID    Defaults to pi-ghosty
`);
  process.exit(exitCode);
}

const [rawMode, ...rest] = process.argv.slice(2);
const mode = String(rawMode ?? "").trim().toLowerCase();
if (!mode) usage(1);
if (!VALID_MODES.has(mode)) {
  console.error(`Invalid mode: ${mode}`);
  usage(1);
}

const customInstructions = rest.join(" ").trim();
if (mode === "custom" && !customInstructions) {
  console.error("custom mode requires custom instructions");
  usage(1);
}

const baseUrl = process.env.HINDSIGHT_BASE_URL?.trim() || "http://localhost:8888";
const bankId = process.env.HINDSIGHT_BANK_ID?.trim() || "pi-ghosty";
const client = new HindsightClient({ baseUrl });

try {
  const result = await client.updateBankConfig(bankId, {
    retainExtractionMode: mode,
    ...(mode === "custom" ? { retainCustomInstructions: customInstructions } : {}),
  });
  console.log(JSON.stringify(result, null, 2));
  syncHindsightHighlights({ banks: [bankId], baseUrl });
} catch (err) {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
}
