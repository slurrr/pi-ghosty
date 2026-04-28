#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { HindsightClient } from "@vectorize-io/hindsight-client";

function readJson(path) {
  try {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, "utf8");
    return raw.trim() ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function uniqBanks(banks) {
  const seen = new Map();
  for (const bank of banks) {
    if (!bank.bankId) continue;
    const existing = seen.get(bank.bankId);
    if (existing) {
      existing.roles.push(bank.role);
      continue;
    }
    seen.set(bank.bankId, { bankId: bank.bankId, roles: [bank.role] });
  }
  return [...seen.values()];
}

function main() {
  const repoRoot = process.cwd();
  const config = readJson(resolve(repoRoot, "pi-agent.json")) ?? {};
  const defaults = config.defaults ?? {};
  const runtime = defaults.runtime ?? {};
  const memory = defaults.memory ?? {};

  const baseUrl = process.env.HINDSIGHT_BASE_URL?.trim() || runtime.hindsightBaseUrl || "http://localhost:8888";
  const proceduralBankId =
    process.env.HINDSIGHT_PROCEDURAL_BANK_ID?.trim() ||
    memory.banks?.procedural?.bankId ||
    runtime.hindsightBankId ||
    "pi-ghosty-procedural";
  const personalBankId =
    process.env.HINDSIGHT_PERSONAL_BANK_ID?.trim() ||
    memory.banks?.personal?.bankId ||
    "pi-ghosty-personal";

  const configuredBanks = uniqBanks([
    { role: "procedural", bankId: proceduralBankId },
    { role: "personal", bankId: personalBankId },
  ]);

  const client = new HindsightClient({ baseUrl });

  const run = async () => {
    const banks = [];

    for (const bank of configuredBanks) {
      try {
        const response = await client.getBankConfig(bank.bankId);
        banks.push({
          roles: bank.roles,
          bank_id: response.bank_id,
          config: response.config,
          overrides: response.overrides,
        });
      } catch (err) {
        banks.push({
          roles: bank.roles,
          bank_id: bank.bankId,
          error: err?.message || String(err),
        });
      }
    }

    const output = {
      base_url: baseUrl,
      config_file: resolve(repoRoot, "pi-agent.json"),
      configured_banks: banks,
    };

    process.stdout.write(JSON.stringify(output, null, 2) + "\n");
  };

  void run().catch((err) => {
    process.stderr.write((err?.stack || err?.message || String(err)) + "\n");
    process.exit(1);
  });
}

main();
