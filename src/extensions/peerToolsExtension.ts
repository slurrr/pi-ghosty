import type { ExtensionFactory } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { defineTool } from "@mariozechner/pi-coding-agent";
import type { GhostyConfig } from "../config/schema.js";

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
      description: "Peer utilities. Subcommands: tools",
      handler: async (args, ctx) => {
        const sub = args.trim();
        if (!sub || sub === "help") {
          if (ctx.hasUI) ctx.ui.notify("Usage: /peer tools", "info");
          return;
        }

        if (sub === "tools") {
          const text = renderPeerTools(config);
          if (ctx.hasUI) {
            await ctx.ui.editor("Peer tools", text);
          }
          return;
        }

        if (ctx.hasUI) ctx.ui.notify(`Unknown subcommand: ${sub}. Try: /peer tools`, "warning");
      },
    });
  };
}
