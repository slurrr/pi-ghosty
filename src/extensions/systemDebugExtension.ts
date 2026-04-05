import type { ExtensionFactory } from "@mariozechner/pi-coding-agent";

function extractGuidelines(systemPrompt: string): string | null {
  const marker = "\nGuidelines:\n";
  const start = systemPrompt.indexOf(marker);
  if (start < 0) return null;
  const rest = systemPrompt.slice(start + marker.length);
  const end = rest.indexOf("\n\nPi documentation");
  const block = (end >= 0 ? rest.slice(0, end) : rest).trim();
  return block || null;
}

export function systemDebugExtensionFactory(): ExtensionFactory {
  return (pi) => {
    pi.registerCommand("system", {
      description: "Show the current effective system prompt.",
      handler: async (args, ctx) => {
        const target = args.trim() || "system";
        const prompt = ctx.getSystemPrompt();
        if (!prompt) {
          ctx.ui.notify("No system prompt available.", "warning");
          return;
        }

        if (target === "guidelines") {
          const guidelines = extractGuidelines(prompt) ?? "(guidelines section not found)";
          await ctx.ui.editor("System guidelines", guidelines);
          return;
        }

        await ctx.ui.editor("System prompt", prompt);
      },
    });
  };
}

