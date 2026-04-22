import type { ExtensionFactory } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { defineTool } from "@mariozechner/pi-coding-agent";
import { sep } from "node:path";
import type { GhostyConfig } from "../config/schema.js";
import { WorkflowMonitor } from "../runtime/workflowMonitor.js";

function renderPeerTools(config: GhostyConfig): string {
  const peers = ["coder", "researcher", "reviewer", "memory"] as const;
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
    ...(top.length > 0 ? top.map((c) => `- ${c.status} ${c.peerName} score=${c.score} id=${c.id}`) : ["- none"]),
  ].join("\n");
}

export function peerToolsExtensionFactory(config: GhostyConfig, agentName: string): ExtensionFactory {
  return (pi) => {
    // Only coordinator needs this.
    if (agentName !== "coordinator") return;

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

    pi.registerCommand("peer", {
      description: "Peer utilities. Subcommands: tools, workflow",
      handler: async (args, ctx) => {
        const sub = args.trim();
        if (!sub || sub === "help") {
          if (ctx.hasUI) ctx.ui.notify("Usage: /peer tools | /peer workflow [limit]", "info");
          return;
        }

        if (sub === "tools") {
          const text = renderPeerTools(config);
          if (ctx.hasUI) {
            await ctx.ui.editor("Peer tools", text);
          }
          return;
        }

        if (sub.startsWith("workflow")) {
          const parts = sub.split(/\s+/).filter(Boolean);
          const limitRaw = Number(parts[1]);
          const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(20, Math.trunc(limitRaw)) : 5;
          const runDir = inferRunDirFromSessionFile(ctx.sessionManager.getSessionFile()) ?? process.cwd();
          const text = await renderWorkflowStatus(runDir, limit);
          if (ctx.hasUI) {
            await ctx.ui.editor("Workflow monitor", text);
          }
          return;
        }

        if (ctx.hasUI) ctx.ui.notify(`Unknown subcommand: ${sub}. Try: /peer tools or /peer workflow`, "warning");
      },
    });
  };
}
