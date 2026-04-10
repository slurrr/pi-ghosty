import type { ExtensionFactory } from "@mariozechner/pi-coding-agent";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { performance } from "node:perf_hooks";
import type { GhostyConfig } from "../config/schema.js";
import type { Env } from "../env.js";
import { createHindsightClient } from "../memory/hindsight.js";
import { JsonlTrace } from "../logging/jsonlTrace.js";

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
  paths: { runDir: string },
): ExtensionFactory {
  const hindsight = createHindsightClient({
    baseUrl: env.HINDSIGHT_BASE_URL || config.defaults.hindsightBaseUrl,
    bankId: env.HINDSIGHT_BANK_ID || config.defaults.hindsightBankId,
  });

  const bankId = env.HINDSIGHT_BANK_ID || config.defaults.hindsightBankId;
  const projectTag = env.PROJECT_TAG || config.defaults.projectTag;

  const baseTags = [projectTag, `agent:${agentName}`, `session:${sessionId}`];
  const trace = JsonlTrace.forAgent(paths.runDir, agentName, sessionId);

  return (pi) => {
    // Async recall timing log (for performance analysis)
    let lastRecallMs = 0;

    pi.on("before_agent_start", async (event) => {
      // Keep recall bounded; we rely on observations + tags + reranking.
      const query = event.prompt;
      const t0 = performance.now();
      try {
        const recalled = await hindsight.recall(bankId, query, {
          max_tokens: 2048,
          budget: "mid",
          tags: [projectTag, `agent:${agentName}`],
          tags_match: "all",
          types: ["observation", "world", "experience"],
          async: true, // Non-blocking async recall
        } as any);

        const facts: any[] = (recalled as any)?.facts ?? (recalled as any)?.results ?? [];
        const memoryLines = Array.isArray(facts)
          ? facts
              .slice(0, 30)
              .map((f) => (typeof f.text === "string" ? `- ${f.text}` : null))
              .filter((x): x is string => !!x)
          : [];
        const memoryBlock = memoryLines.join("\n");

        const t1 = performance.now();
        lastRecallMs = Math.round(t1 - t0);
        await trace.append({
          type: "memory_recall",
          projectTag,
          bankId,
          agentName,
          sessionId,
          ms: Math.round(t1 - t0),
          queryLen: query.length,
          factsCount: Array.isArray(facts) ? facts.length : null,
          injectedLines: memoryLines.length,
          injectedChars: memoryBlock.length,
        });

        if (!memoryBlock.trim()) return undefined;
        const injected = `${event.systemPrompt}\n\n# Recalled Memory (${agentName})\n${memoryBlock}`;
        return { systemPrompt: injected };
      } catch (err: any) {
        const t1 = performance.now();
        lastRecallMs = Math.round(t1 - t0);
        await trace.append({
          type: "memory_recall_error",
          projectTag,
          bankId,
          agentName,
          sessionId,
          ms: Math.round(t1 - t0),
          error: err?.message ?? String(err),
        });
        return undefined;
      }
    });

    pi.on("agent_end", async (event) => {
      const transcript = messagesToTranscript(event.messages);
      if (!transcript.trim()) return;

      const documentId = `${projectTag}/${agentName}/${sessionId}`;
      const t0 = performance.now();
      try {
        await hindsight.retain(bankId, transcript, {
          document_id: documentId,
          context: "pi-ghosty agent session transcript",
          tags: baseTags,
          // v1: consolidate at durable scopes (project and agent), not per-session by default.
          observation_scopes: {
            mode: "custom",
            scopes: [[projectTag], [`agent:${agentName}`]],
          },
          async: true, // Non-blocking async retain
        } as any);
        const t1 = performance.now();
        const recallMs = Math.round(t1 - t0);
        await trace.append({
          type: "memory_retain",
          projectTag,
          bankId,
          agentName,
          sessionId,
          ms: Math.round(t1 - t0),
          documentId,
          transcriptChars: transcript.length,
          tags: baseTags,
          recallMs, // Include recall latency for comparison
        });
        // Update latency log with actual retain time
        await trace.append({
          type: "memory_latency",
          projectTag,
          bankId,
          agentName,
          sessionId,
          recallMs,
          retainMs: Math.round(t1 - t0),
        });
      } catch (err: any) {
        const t1 = performance.now();
        await trace.append({
          type: "memory_retain_error",
          projectTag,
          bankId,
          agentName,
          sessionId,
          ms: Math.round(t1 - t0),
          documentId,
          transcriptChars: transcript.length,
          error: err?.message ?? String(err),
        });
        // Still log latency even on error
        await trace.append({
          type: "memory_latency",
          projectTag,
          bankId,
          agentName,
          sessionId,
          recallMs: 0,
          retainMs: Math.round(t1 - t0),
        });
      }
    });

    // Reflect is not wired into pi-ghosty v1 yet. When we add it (manual or scheduled),
    // instrument it with the same timing/size trace shape as retain/recall.
    void hindsight;
  };
}

