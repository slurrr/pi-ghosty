import fs from "node:fs";
import path from "node:path";

function loadConfig() {
  const configPath = process.env.GHOSTY_AGENT_CONFIG_PATH?.trim()
    ? path.resolve(process.env.GHOSTY_AGENT_CONFIG_PATH.trim())
    : path.resolve("pi-agent.json");
  const raw = fs.readFileSync(configPath, "utf8");
  return { configPath, config: JSON.parse(raw) };
}

async function patchBank(baseUrl, bankId, updates) {
  const filtered = Object.fromEntries(Object.entries(updates).filter(([, value]) => value !== undefined));
  console.log(`Updating ${bankId}...`);
  await fetch(`${baseUrl}/v1/default/banks/${bankId}/config`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ updates: filtered }),
  });
}

async function main() {
  const { configPath, config } = loadConfig();
  const baseUrl = process.env.HINDSIGHT_BASE_URL?.trim() || config?.defaults?.runtime?.hindsightBaseUrl || "http://localhost:8888";
  const banks = config?.defaults?.memory?.banks ?? {};

  console.log(`Using config: ${configPath}`);
  console.log(`Using Hindsight: ${baseUrl}`);

  for (const role of ["procedural", "personal"]) {
    const bank = banks?.[role];
    if (!bank?.bankId) continue;
    const hindsight = bank?.hindsight ?? {};
    await patchBank(baseUrl, bank.bankId, {
      retain_extraction_mode: hindsight.retainExtractionMode,
      retain_mission: hindsight.retainMission,
      observations_mission: hindsight.observationsMission,
      consolidation_llm_batch_size: hindsight.consolidationLlmBatchSize,
      consolidation_max_memories_per_round: hindsight.consolidationMaxMemoriesPerRound,
      consolidation_source_facts_max_tokens: hindsight.consolidationSourceFactsMaxTokens,
      consolidation_source_facts_max_tokens_per_observation: hindsight.consolidationSourceFactsMaxTokensPerObservation,
      max_observations_per_scope: hindsight.maxObservationsPerScope,
      reflect_mission: hindsight.reflectMission,
      reflect_source_facts_max_tokens: hindsight.reflectSourceFactsMaxTokens,
      recall_include_chunks: hindsight.recallIncludeChunks,
      recall_max_tokens: hindsight.recallMaxTokens,
      recall_chunks_max_tokens: hindsight.recallChunksMaxTokens,
      disposition_skepticism: hindsight.dispositionSkepticism,
      disposition_literalism: hindsight.dispositionLiteralism,
      disposition_empathy: hindsight.dispositionEmpathy,
    });
  }

  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
