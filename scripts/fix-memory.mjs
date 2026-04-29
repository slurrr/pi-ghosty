import { HindsightClient } from "@vectorize-io/hindsight-client";

async function main() {
  const proceduralBankId = "pi-ghosty-procedural";
  const personalBankId = "pi-ghosty-personal";

  console.log("Updating procedural bank...");
  await fetch(`http://localhost:8888/v1/default/banks/${proceduralBankId}/config`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      updates: {
        retain_extraction_mode: "concise",
        retain_mission: "Extract reusable procedural and technical context. Focus on content useful across future tasks. CRITICAL: Do NOT extract facts about the memory system itself, model configurations (topP, temperature, etc.), tool definitions, or meta-information like 'transcript was recorded at'. Ignore system-level noise.",
        observations_mission: "Observations are durable procedural knowledge and reusable project lessons. Prefer observations that make future delegated workers faster and less error-prone."
      }
    })
  });

  console.log("Updating personal bank...");
  await fetch(`http://localhost:8888/v1/default/banks/${personalBankId}/config`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      updates: {
        retain_extraction_mode: "concise",
        retain_mission: "Extract Seth's working style, interaction rules, and recurring personal workflow choices. CRITICAL: Do NOT extract facts about model settings, system configurations, or administrative metadata. Focus only on Seth's direct feedback, stated preferences, and observable work habits.",
        observations_mission: "Observations are stable facts about Seth. Synthesize facts that are relevant to Seth's preferred workflow and assistant behavior. Facts that will help the assistant and Seth work more effectively together."
      }
    })
  });

  console.log("Done.");
}

main().catch(console.error);
