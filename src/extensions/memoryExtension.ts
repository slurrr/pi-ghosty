import type { ExtensionFactory } from "@mariozechner/pi-coding-agent";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { GhostyConfig } from "../config/schema.js";
import type { Env } from "../env.js";
import { createHindsightClient } from "../memory/hindsight.js";

function messagesToTranscript(messages: AgentMessage[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    if (m.role === "user" && typeof m.content === "string") {
      lines.push(`User: ${m.content}`);
    } else if (m.role === "assistant") {
      const content = (m as any).content;
      if (typeof content === "string") {
        lines.push(`Assistant: ${content}`);
      } else if (Array.isArray(content)) {
        const textBlocks = content
          .filter((b: any) => b.type === "text" && typeof b.text === "string")
          .map((b: any) => b.text)
          .join("");
        if (textBlocks.trim()) lines.push(`Assistant: ${textBlocks}`);
      }
    } else if (m.role === "toolResult") {
      const content = (m as any).content;
      if (Array.isArray(content)) {
        const text = content
          .filter((b: any) => b.type === "text" && typeof b.text === "string")
          .map((b: any) => b.text)
          .join("");
        if (text.trim()) lines.push(`ToolResult(${(m as any).toolName ?? "tool"}): ${text}`);
      }
    }
  }
  return lines.join("\n");
}

export function memoryExtensionFactory(
  env: Env,
  config: GhostyConfig,
  agentName: string,
  sessionId: string,
): ExtensionFactory {
  const hindsight = createHindsightClient({
    baseUrl: env.HINDSIGHT_BASE_URL || config.defaults.hindsightBaseUrl,
    bankId: env.HINDSIGHT_BANK_ID || config.defaults.hindsightBankId,
  });

  const bankId = env.HINDSIGHT_BANK_ID || config.defaults.hindsightBankId;
  const projectTag = env.PROJECT_TAG || config.defaults.projectTag;

  const baseTags = [projectTag, `agent:${agentName}`, `session:${sessionId}`];

  return (pi) => {
    pi.on("before_agent_start", async (event) => {
      // Keep recall bounded; we rely on observations + tags + reranking.
      const query = event.prompt;
      const recalled = await hindsight.recall(bankId, query, {
        max_tokens: 2048,
        budget: "mid",
        tags: [projectTag, `agent:${agentName}`],
        tags_match: "all",
        types: ["observation", "world", "experience"],
      } as any);

      const facts: any[] = (recalled as any)?.facts ?? (recalled as any)?.results ?? [];
      if (!Array.isArray(facts) || facts.length === 0) {
        return undefined;
      }

      const memoryBlock = facts
        .slice(0, 30)
        .map((f) => (typeof f.text === "string" ? `- ${f.text}` : null))
        .filter((x): x is string => !!x)
        .join("\n");

      if (!memoryBlock.trim()) {
        return undefined;
      }

      const injected = `${event.systemPrompt}\n\n# Recalled Memory (${agentName})\n${memoryBlock}`;
      return { systemPrompt: injected };
    });

    pi.on("agent_end", async (event) => {
      const transcript = messagesToTranscript(event.messages);
      if (!transcript.trim()) return;

      const documentId = `${projectTag}/${agentName}/${sessionId}`;

      await hindsight.retain(bankId, transcript, {
        document_id: documentId,
        context: "pi-ghosty agent session transcript",
        tags: baseTags,
        // v1: consolidate at durable scopes (project and agent), not per-session by default.
        observation_scopes: {
          mode: "custom",
          scopes: [[projectTag], [`agent:${agentName}`]],
        },
      } as any);
    });
  };
}

