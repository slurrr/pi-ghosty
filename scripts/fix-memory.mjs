import fs from "node:fs";
import path from "node:path";

function loadJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function loadAgentConfig() {
  const configPath = process.env.GHOSTY_AGENT_CONFIG_PATH?.trim()
    ? path.resolve(process.env.GHOSTY_AGENT_CONFIG_PATH.trim())
    : path.resolve("pi-agent.json");
  return { configPath, config: loadJson(configPath) };
}

function loadBankConfig() {
  const bankConfigPath = process.env.GHOSTY_MEMORY_BANK_CONFIG_PATH?.trim()
    ? path.resolve(process.env.GHOSTY_MEMORY_BANK_CONFIG_PATH.trim())
    : path.resolve("memory/banks.config.json");
  return { bankConfigPath, bankConfig: loadJson(bankConfigPath) };
}

async function patchBank(baseUrl, bankId, updates) {
  const filtered = Object.fromEntries(Object.entries(updates ?? {}).filter(([, value]) => value !== undefined));
  console.log(`Updating ${bankId}...`);
  await fetch(`${baseUrl}/v1/default/banks/${bankId}/config`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ updates: filtered }),
  });
}

import { syncHindsightHighlights } from "./_highlights_sync.mjs";

async function main() {
  const { configPath, config } = loadAgentConfig();
  const { bankConfigPath, bankConfig } = loadBankConfig();

  const baseUrl = process.env.HINDSIGHT_BASE_URL?.trim()
    || bankConfig?.hindsightBaseUrl
    || config?.defaults?.runtime?.hindsightBaseUrl
    || "http://localhost:8888";

  const banks = bankConfig?.banks ?? {};

  console.log(`Using runtime config: ${configPath}`);
  console.log(`Using bank config: ${bankConfigPath}`);
  console.log(`Using Hindsight: ${baseUrl}`);

  const touchedBanks = [];
  for (const role of ["procedural", "personal"]) {
    const bank = banks?.[role];
    if (!bank?.bankId) continue;
    await patchBank(baseUrl, bank.bankId, bank.updates ?? {});
    touchedBanks.push(bank.bankId);
  }

  if (touchedBanks.length) {
    syncHindsightHighlights({ banks: touchedBanks, baseUrl });
  }

  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
