#!/usr/bin/env node

import { HindsightClient } from "@vectorize-io/hindsight-client";
import { syncHindsightHighlights } from "./_highlights_sync.mjs";

function usage(exitCode = 1) {
  console.error(`Usage:
  node scripts/set-observations-mission.mjs <observations mission text>

Environment:
  HINDSIGHT_BASE_URL   Defaults to http://localhost:8888
  HINDSIGHT_BANK_ID    Defaults to pi-ghosty
`);
  process.exit(exitCode);
}

const mission = process.argv.slice(2).join(" ").trim();
if (!mission) usage(1);

const baseUrl = process.env.HINDSIGHT_BASE_URL?.trim() || "http://localhost:8888";
const bankId = process.env.HINDSIGHT_BANK_ID?.trim() || "pi-ghosty";
const client = new HindsightClient({ baseUrl });

try {
  const result = await client.updateBankConfig(bankId, {
    observationsMission: mission,
  });
  console.log(JSON.stringify(result, null, 2));
  syncHindsightHighlights({ banks: [bankId], baseUrl });
} catch (err) {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
}
