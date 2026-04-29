import type { ExtensionFactory } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { defineTool } from "@mariozechner/pi-coding-agent";
import { sep } from "node:path";
import type { GhostyConfig } from "../config/schema.js";
import { WorkflowMonitor } from "../workflow/workflowMonitor.js";

function renderPeerTools(config: GhostyConfig): string {
  const peers = ["coder", "researcher", "pilot", "reviewer", "memory"] as const;
  const lines: string[] = [];
  for (const p of peers) {
    const tools = config.agents[p]?.tools ?? [];
    const full = [...tools, "peer_report"];
    lines.push(`- @${p}: ${full.join(", ") || "(no tools)"}`);
  }
  return ["Peer tool surfaces (from pi-agent.json)", "", ...lines].join("\n");
}

function inferRunDirFromSessionFile(sessionFile: string | undefined): string | null {
  if (!sessionFile) return null;
  const marker = `${sep}data${sep}sessions${sep}`;
  const idx = sessionFile.lastIndexOf(marker);
  if (idx < 0) return null;
  return sessionFile.slice(0, idx);
}

async function renderWorkflowStatus(runDir: string, limit = 5): Promise<string> {
  const latest = await WorkflowMonitor.readLatest(runDir);
  if (!latest) return "workflow monitor: no summary yet";
  const top = latest.topScreened.slice(0, Math.max(1, limit));
  return [
    "workflow monitor",
    `updatedAt: ${latest.ts}`,
    `window: ${latest.windowStart} -> ${latest.windowEnd}`,
    `screened: winners=${latest.counts.winner}, candidates=${latest.counts.candidate}, parked=${latest.counts.parked}`,
    "top:",
    ...(top.length > 0 ? top.map((c) => `- ${c.status} ${c.title} score=${c.score} id=${c.id}`) : ["- none"]),
  ].join("\n");
}

export function peerToolsExtensionFactory(config: GhostyConfig, agentName: string): ExtensionFactory {
  return (pi) => {
    // Only coordinator needs this.
    if (agentName !== "coordinator") return;

    // Tool only. Commands live under /ghosty in the extension so we don't have to chase
    // duplicate command registration paths.
    pi.registerTool(
      defineTool({
        name: "peer_tools",
        label: "Peer Tools",
        description: "List the worker peers and the tools available to each (from config).",
        parameters: Type.Object({}),
        execute: async () => {
          const text = renderPeerTools(config);
          return {
            content: [{ type: "text", text }],
            details: { peers: config.agents },
          };
        },
      }),
    );
  };
}
