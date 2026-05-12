import type { ExtensionFactory } from "@mariozechner/pi-coding-agent";

function roleFirstSentence(agentName: string): string | undefined {
  if (agentName === "coder") return undefined;
  if (agentName === "corroborator") {
    return (
      "default to conversation. " +
      "help define the real problem before reaching for tools. " +
      "ask the smallest useful question when the shape is unclear. " +
      "stay exploratory until ghosty and seth agree the problem is sharp, then switch to operational and move fast."
    );
  }
  if (agentName === "researcher") {
    return (
      "You are the researcher peer for pi-ghosty (internal; not user-facing). " +
      "Do local repository/system investigation only and report concise, reproducible findings back to the corroborator using the `peer-report` skill. " +
      "Use the .pi/skills/peer-report/SKILL.md file for guidance."

    );
  }
  if (agentName === "reviewer") {
    return (
      "You are the reviewer peer for pi-ghosty (internal; not user-facing). " +
      "Review proposed changes for correctness, safety, and scope drift, and report concrete issues and a short checklist back to the corroborator."
    );
  }
  if (agentName === "memory") {
    return (
      "You are the memory peer for pi-ghosty (internal; not user-facing). " +
      "Focus on long-term memory behavior (recall/retain, tags, scopes, observations) and report recommendations back to the corroborator."
    );
  }
  return undefined;
}

function replaceFirstParagraph(systemPrompt: string, replacement: string): string {
  const normalized = systemPrompt.trimStart();
  const paragraphEnd = normalized.indexOf("\n\n");
  if (paragraphEnd === -1) return replacement;
  const rest = normalized.slice(paragraphEnd).trimStart();
  return `${replacement}\n\n${rest}`;
}

/**
 * Ensures non-coder agents do NOT get pi's default "expert coding assistant" framing.
 *
 * We do this at `before_agent_start` because pi's default system prompt is not necessarily
 * file-backed (so ResourceLoader.systemPromptOverride may not fire).
 */
export function roleSystemPromptExtensionFactory(agentName: string): ExtensionFactory {
  return (pi) => {
    pi.on("before_agent_start", (event) => {
      const replacement = roleFirstSentence(agentName);
      if (!replacement) return undefined;

      const marker = "You are an expert coding assistant operating inside pi";
      const normalized = event.systemPrompt.trimStart();

      if (normalized.startsWith(marker)) {
        return { systemPrompt: replaceFirstParagraph(event.systemPrompt, replacement) };
      }

      // Fallback: just prefix our role guidance.
      return { systemPrompt: `${replacement}\n\n${event.systemPrompt}` };
    });
  };
}
