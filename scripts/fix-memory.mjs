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
        retain_mission: "Retain only facts that relate to projects, tasks, and systems. Focus on content that will help the assistant work more effectively on projects and tasks in future interactions. CRITICAL: Do NOT retain facts about Seth's personal tastes, working style, or interaction rules. There is a whole bank for that purpose this one is specifically for procedural and technical context.",
        observations_mission: "Observations are stable facts about projects, tasks, and systems. Facts that will help the assistant work more effectively on projects and tasks in future interactions. Synthesize observations across interactions to identify patterns in project types, task workflows, and system configurations. Focus on content that is likely to remain true over time, rather than transient details about specific projects or tasks. ABSOLUTELY NO OBSERVATIONS ABOUT ANYTHING PERSONAL RELATED. Ignore any information that does not directly relate to projects, tasks, or systems."
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
        retain_mission: "Retain facts about Seth's working style, interaction rules, and recurring personal workflow choices. Focus on content that will help the assistant work more effectively with Seth in future interactions. CRITICAL: Do NOT retain facts about projects Seth is working on, specific tasks he is doing, or any model settings, system configurations, or administrative metadata. There is a whole bank for that purpose this one is specifically for Seth's personal tastes.",
        observations_mission: "Observations are stable facts about Seth. Facts that will help the assistant and Seth work more effectively together. Synthesize observations across interactions to identify patterns in Seth's working style, preferences, and habits. Focus on content that is likely to remain true over time, rather than transient details about specific projects or tasks. ABSOLUTELY NO OBSERVATIONS ABOUT ANYTHING PROJECT, TASK, OR SYSTEM RELATED. Ignore any information that does not directly relate to Seth's personal tastes."
      }
    })
  });

  console.log("Done.");
}

main().catch(console.error);
