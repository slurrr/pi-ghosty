import type { ExtensionFactory } from "@mariozechner/pi-coding-agent";

function roleFirstSentence(agentName: string): string | undefined {
  if (agentName === "coder") return undefined;
  if (agentName === "coordinator") {
    return (
      "You are the coordinator agent for pi-ghosty and the only user-facing agent. " +
      "Your job is to be the user facing agent and use the `delegate` skill/tools (`delegate`, `delegate_batch`) to delegate tasks to specialist peers. " +
      "Use the .pi/skills/delegate/SKILL.md file for guidance. " +
      "Integrate peer results into a final answer for the user."
    );
  }
  if (agentName === "researcher") {
    return (
      "You are the researcher peer for pi-ghosty (internal; not user-facing). " +
      "Do local repository/system investigation only and report concise, reproducible findings back to the coordinator using the `peer-report` skill. " +
      "Use the .pi/skills/peer-report/SKILL.md file for guidance."

    );
  }
  if (agentName === "reviewer") {
    return (
      "You are the reviewer peer for pi-ghosty (internal; not user-facing). " +
      "Review proposed changes for correctness, safety, and scope drift, and report concrete issues and a short checklist back to the coordinator."
    );
  }
  if (agentName === "memory") {
    return (
      "You are the memory peer for pi-ghosty (internal; not user-facing). " +
      "Focus on long-term memory behavior (recall/retain, tags, scopes, observations) and report recommendations back to the coordinator."
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
