import { estimateTokens, type ExtensionFactory } from "@mariozechner/pi-coding-agent";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { performance } from "node:perf_hooks";
import type { GhostyConfig } from "../config/schema.js";
import type { Env } from "../env.js";
import {
  createHindsightClient,
  getOperationStatusDirect,
  retainMemoriesDirect,
  type RetainMemoryItem,
} from "../memory/hindsight.js";
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

function estimateTextTokens(text: string): number {
  return Math.max(1, estimateTokens({ role: "user", content: text } as any));
}

function truncateToEstimatedTokens(text: string, maxTokens: number): { text: string; estimatedTokens: number } {
  if (!text.trim()) return { text: "", estimatedTokens: 0 };
  let current = text;
  let estimated = estimateTextTokens(current);
  if (estimated <= maxTokens) return { text: current, estimatedTokens: estimated };

  let lo = 0;
  let hi = current.length;
  let best = "";
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const candidate = current.slice(0, mid).trimEnd();
    const tokens = candidate ? estimateTextTokens(candidate) : 0;
    if (tokens <= maxTokens) {
      best = candidate;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (!best) {
    const tiny = current.slice(0, Math.max(1, Math.min(32, current.length))).trim();
    return { text: tiny, estimatedTokens: tiny ? estimateTextTokens(tiny) : 0 };
  }

  return { text: best, estimatedTokens: estimateTextTokens(best) };
}

function toIsoTimestamp(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }
  return undefined;
}

function pickMessageTimestamp(messages: any[], pick: "first" | "last"): string | undefined {
  if (!Array.isArray(messages) || messages.length === 0) return undefined;
  if (pick === "first") {
    for (const m of messages) {
      const ts = toIsoTimestamp(m?.timestamp);
      if (ts) return ts;
    }
    return undefined;
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const ts = toIsoTimestamp(messages[i]?.timestamp);
    if (ts) return ts;
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function memoryExtensionFactory(
  env: Env,
  config: GhostyConfig,
  agentName: string,
  sessionId: string,
  paths: { runDir: string },
): ExtensionFactory {
  const baseUrl = env.HINDSIGHT_BASE_URL || config.defaults.runtime?.hindsightBaseUrl || "http://localhost:8888";
  const bankId = env.HINDSIGHT_BANK_ID || config.defaults.runtime?.hindsightBankId || "pi-ghosty";
  const projectTag = env.PROJECT_TAG || config.defaults.projectTag;
  const memoryDefaults = config.defaults.memory;
  const recallCfg = memoryDefaults.recall;
  const retainCfg = memoryDefaults.retain;
  const operationsCfg = memoryDefaults.operations;

  const hindsight = createHindsightClient({
    baseUrl,
    bankId,
  });

  const baseTags = [projectTag, `agent:${agentName}`, `session:${sessionId}`];
  const recallTags = [projectTag, `agent:${agentName}`];
  const observationScopes = [
    ...(retainCfg.observationScopes.includeProjectScope ? [[projectTag]] : []),
    ...(retainCfg.observationScopes.includeAgentScope ? [[`agent:${agentName}`]] : []),
    ...(retainCfg.observationScopes.includeSessionScope ? [[`session:${sessionId}`]] : []),
  ];
  const trace = JsonlTrace.forAgent(paths.runDir, agentName, sessionId);

  return (pi) => {
    // Async recall timing log (for performance analysis)
    let lastRecallMs = 0;

    pi.on("before_agent_start", async (event) => {
      const rawQuery = String(event.prompt ?? "");
      const queryCharsCapped = recallCfg.queryMaxChars && recallCfg.queryMaxChars > 0
        ? rawQuery.slice(0, recallCfg.queryMaxChars)
        : rawQuery;

      const estimatedBeforeTrim = estimateTextTokens(queryCharsCapped);
      const shaped = truncateToEstimatedTokens(queryCharsCapped, recallCfg.queryMaxTokens);
      const query = shaped.text;

      const eventMessages = Array.isArray((event as any)?.messages) ? (event as any).messages : [];
      const queryTimestamp = (() => {
        if (recallCfg.queryTimestampMode === "custom") return recallCfg.queryTimestampValue;
        if (recallCfg.queryTimestampMode === "message") return pickMessageTimestamp(eventMessages, "last");
        if (recallCfg.queryTimestampMode === "session") return pickMessageTimestamp(eventMessages, "first");
        return new Date().toISOString();
      })();

      const t0 = performance.now();
      try {
        const recalled = await hindsight.recall(bankId, query, {
          maxTokens: recallCfg.maxTokens,
          budget: recallCfg.budget,
          tags: recallTags,
          tagsMatch: recallCfg.tagsMatch,
          types: recallCfg.types,
          queryTimestamp,
          includeSourceFacts: recallCfg.includeSourceFacts,
          maxSourceFactsTokens: recallCfg.includeSourceFactsMaxTokens,
          includeChunks: recallCfg.includeChunks,
          maxChunkTokens: recallCfg.includeChunksMaxTokens,
          async: recallCfg.async,
        } as any);

        const facts: any[] = (recalled as any)?.facts ?? (recalled as any)?.results ?? [];
        const memoryLines = Array.isArray(facts)
          ? facts
              .slice(0, recallCfg.maxFacts)
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
          estimatedQueryTokensRaw: estimatedBeforeTrim,
          estimatedQueryTokensFinal: shaped.estimatedTokens,
          queryTrimmed: shaped.estimatedTokens < estimatedBeforeTrim,
          queryTimestamp: queryTimestamp ?? null,
          includeSourceFacts: recallCfg.includeSourceFacts,
          includeChunks: recallCfg.includeChunks,
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
          estimatedQueryTokensRaw: estimatedBeforeTrim,
          estimatedQueryTokensFinal: shaped.estimatedTokens,
        });
        return undefined;
      }
    });

    pi.on("agent_end", async (event) => {
      const transcript = messagesToTranscript(event.messages);
      if (!transcript.trim()) return;

      const documentId = `${projectTag}/${agentName}/${sessionId}`;
      const eventMessages = Array.isArray((event as any)?.messages) ? (event as any).messages : [];
      const retainTimestamp = (() => {
        if (retainCfg.timestampMode === "none") return "unset";
        if (retainCfg.timestampMode === "message") return pickMessageTimestamp(eventMessages, "last") ?? new Date().toISOString();
        if (retainCfg.timestampMode === "session") return pickMessageTimestamp(eventMessages, "first") ?? new Date().toISOString();
        return new Date().toISOString();
      })();

      const item: RetainMemoryItem = {
        content: transcript,
        timestamp: retainTimestamp,
        document_id: documentId,
        context: retainCfg.context,
        tags: baseTags,
        observation_scopes:
          retainCfg.observationScopes.mode === "custom" && observationScopes.length > 0
            ? observationScopes
            : undefined,
      };

      const t0 = performance.now();
      let retainResponse: any;
      let retainTransport: "direct" | "sdk" = "direct";
      try {
        try {
          retainResponse = await retainMemoriesDirect(baseUrl, bankId, {
            items: [item],
            async: retainCfg.async,
            ...(retainCfg.updateMode !== "replace" ? { update_mode: retainCfg.updateMode } : {}),
          });
        } catch (directErr: any) {
          retainTransport = "sdk";
          await trace.append({
            type: "memory_retain_update_mode_fallback",
            projectTag,
            bankId,
            agentName,
            sessionId,
            updateMode: retainCfg.updateMode,
            error: directErr?.message ?? String(directErr),
          });

          // Fallback to SDK batch retain (does not currently expose update_mode)
          retainResponse = await hindsight.retainBatch(bankId, [item as any], {
            async: retainCfg.async,
            documentId,
          });
        }

        const t1 = performance.now();
        const operationIds: string[] = Array.isArray(retainResponse?.operation_ids)
          ? retainResponse.operation_ids.filter((id: any) => typeof id === "string")
          : typeof retainResponse?.operation_id === "string"
            ? [retainResponse.operation_id]
            : [];

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
          retainTransport,
          updateMode: retainCfg.updateMode,
          retainTimestamp,
          operationIds,
          recallMs: lastRecallMs,
        });

        const shouldPollOperations = retainCfg.async && operationIds.length > 0 && (operationsCfg.enabled || retainCfg.waitForCompletion);
        if (shouldPollOperations) {
          const timeoutMs = retainCfg.waitForCompletion ? retainCfg.waitTimeoutMs : operationsCfg.timeoutMs;
          for (const operationId of operationIds) {
            const started = Date.now();
            let finalStatus = "pending";
            let lastError: string | null = null;

            while (Date.now() - started < timeoutMs) {
              try {
                const status = await getOperationStatusDirect(baseUrl, bankId, operationId);
                finalStatus = String(status.status || "pending");
                lastError = typeof status.error_message === "string" ? status.error_message : null;

                if (finalStatus === "completed" || finalStatus === "failed" || finalStatus === "not_found") {
                  break;
                }
              } catch (err: any) {
                finalStatus = "error";
                lastError = err?.message ?? String(err);
                break;
              }

              await sleep(operationsCfg.pollIntervalMs);
            }

            const timedOut = finalStatus === "pending";
            await trace.append({
              type: "memory_operation_status",
              projectTag,
              bankId,
              agentName,
              sessionId,
              operationId,
              status: timedOut ? "timeout" : finalStatus,
              elapsedMs: Date.now() - started,
              error: lastError,
            });
          }
        }

        // Update latency log with actual retain time
        await trace.append({
          type: "memory_latency",
          projectTag,
          bankId,
          agentName,
          sessionId,
          recallMs: lastRecallMs,
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
          recallMs: lastRecallMs,
          retainMs: Math.round(t1 - t0),
        });
      }
    });

    // Reflect is not wired into pi-ghosty v1 yet. When we add it (manual or scheduled),
    // instrument it with the same timing/size trace shape as retain/recall.
    void hindsight;
  };
}
