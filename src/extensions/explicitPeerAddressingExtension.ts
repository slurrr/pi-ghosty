import type { ExtensionFactory } from "@mariozechner/pi-coding-agent";

const peerAliases: Record<string, "coder" | "researcher" | "reviewer" | "memory"> = {
  coder: "coder",
  researcher: "researcher",
  reviewer: "reviewer",
  memory: "memory",
};

function parseExplicitPeerPrefix(text: string): { peerName: keyof typeof peerAliases; task: string } | null {
  const trimmed = text.trim();
  const match = trimmed.match(/^@([a-zA-Z]+)(?:\s+([\s\S]+))?$/);
  if (!match) return null;
  const peerName = match[1].toLowerCase() as keyof typeof peerAliases;
  if (!peerAliases[peerName]) return null;
  const task = (match[2] ?? "").trim();
  return { peerName, task };
}

export function explicitPeerAddressingExtensionFactory(agentName: string): ExtensionFactory {
  return (pi) => {
    pi.on("input", async (event, ctx) => {
      if (agentName !== "coordinator") return undefined;
      const parsed = parseExplicitPeerPrefix(event.text);
      if (!parsed) return undefined;

      if (!parsed.task) {
        if (ctx.hasUI) ctx.ui.notify(`Usage: @${parsed.peerName} <task>`, "info");
        return { action: "handled" };
      }

      const peer = peerAliases[parsed.peerName];
      const rewritten =
        `Delegate this to @${peer} via the delegate tool.\n` +
        `peerName: ${peer}\n` +
        `task: ${parsed.task}\n`;

      return { action: "transform", text: rewritten, images: event.images };
    });
  };
}

