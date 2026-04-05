import type { ExtensionFactory } from "@mariozechner/pi-coding-agent";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";

function extractGuidelines(systemPrompt: string): string | null {
  const marker = "\nGuidelines:\n";
  const start = systemPrompt.indexOf(marker);
  if (start < 0) return null;
  const rest = systemPrompt.slice(start + marker.length);
  const end = rest.indexOf("\n\nPi documentation");
  const block = (end >= 0 ? rest.slice(0, end) : rest).trim();
  return block || null;
}

function inferRunDirFromSessionFile(sessionFile: string | undefined): string | null {
  if (!sessionFile) return null;
  const marker = `${sep}data${sep}sessions${sep}`;
  const idx = sessionFile.lastIndexOf(marker);
  if (idx < 0) return null;
  return sessionFile.slice(0, idx);
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

        const isGuidelines = target === "guidelines" || target === "dump guidelines";
        if (isGuidelines) {
          const guidelines = extractGuidelines(prompt) ?? "(guidelines section not found)";
          if (target.startsWith("dump")) {
            const runDir = inferRunDirFromSessionFile(ctx.sessionManager.getSessionFile()) ?? process.cwd();
            const debugDir = resolve(runDir, "data", "debug");
            mkdirSync(debugDir, { recursive: true });
            const ts = new Date().toISOString().replace(/[:.]/g, "-");
            const outPath = resolve(debugDir, `system-guidelines-${ctx.sessionManager.getSessionId()}-${ts}.txt`);
            writeFileSync(outPath, guidelines, "utf8");
            ctx.ui.notify(`Wrote ${outPath}`, "info");
            return;
          }
          await ctx.ui.editor("System guidelines", guidelines);
          return;
        }

        if (target === "dump") {
          const runDir = inferRunDirFromSessionFile(ctx.sessionManager.getSessionFile()) ?? process.cwd();
          const debugDir = resolve(runDir, "data", "debug");
          mkdirSync(debugDir, { recursive: true });
          const ts = new Date().toISOString().replace(/[:.]/g, "-");
          const outPath = resolve(debugDir, `system-${ctx.sessionManager.getSessionId()}-${ts}.txt`);
          writeFileSync(outPath, prompt, "utf8");
          ctx.ui.notify(`Wrote ${outPath}`, "info");
          return;
        }

        await ctx.ui.editor("System prompt", prompt);
      },
    });
  };
}
