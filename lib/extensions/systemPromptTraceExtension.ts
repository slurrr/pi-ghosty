import { appendFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type { ExtensionFactory } from "@mariozechner/pi-coding-agent";

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function systemPromptTraceExtensionFactory(args: {
  runDir: string;
  agentName: string;
  sessionId: string;
}): ExtensionFactory {
  const { runDir, agentName, sessionId } = args;

  const outDir = resolve(runDir, "data", "system-prompts", agentName);
  const outFile = resolve(outDir, `${sessionId}.jsonl`);

  let lastHash: string | null = null;

  return (pi) => {
    pi.on("agent_start", (_event, ctx) => {
      const prompt = ctx.getSystemPrompt();
      if (!prompt) return;

      const hash = sha256(prompt);
      if (hash === lastHash) return;
      lastHash = hash;

      mkdirSync(outDir, { recursive: true });
      appendFileSync(
        outFile,
        `${JSON.stringify({
          ts: new Date().toISOString(),
          agentName,
          sessionId,
          hash,
          length: prompt.length,
          prompt,
        })}\n`,
        "utf8",
      );
    });
  };
}

