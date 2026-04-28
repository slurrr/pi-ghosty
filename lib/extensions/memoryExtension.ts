import { estimateTokens, type ExtensionFactory } from "@mariozechner/pi-coding-agent";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { dirname, resolve } from "node:path";
import type { GhostyConfig } from "../config/schema.js";
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

function safeTsId(ts: string): string {
  return ts.replace(/[:.]/g, "-");
}

function memoryReceiptRoot(runDir: string): string {
  return resolve(runDir, "data", "memory", "receipts");
}

function memoryReceiptSessionDir(runDir: string, agentName: string, sessionId: string): string {
  return resolve(memoryReceiptRoot(runDir), agentName, sessionId);
}

function listDirs(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

function findMostRecentSessionDir(runDir: string, agentName: string): string | null {
  const agentDir = resolve(memoryReceiptRoot(runDir), agentName);
  const sessions = listDirs(agentDir);
  let best: string | null = null;
  let bestMtime = 0;
  for (const sessionId of sessions) {
    const latest = resolve(agentDir, sessionId, "latest.json");
    try {
      const st = statSync(latest);
      if (st.mtimeMs > bestMtime) {
        bestMtime = st.mtimeMs;
        best = resolve(agentDir, sessionId);
      }
    } catch {
      // ignore
    }
  }
  return best;
}

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeText(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content.endsWith("\n") ? content : content + "\n", "utf8");
}

function updateMemoryIndex(runDir: string, agentNames: string[]): void {
  try {
    const blocks: string[] = [];
    blocks.push("ghosty memory receipts (latest per agent)");
    blocks.push("");

    for (const agentName of agentNames) {
      const sessionDir = findMostRecentSessionDir(runDir, agentName);
      if (!sessionDir) {
        blocks.push(`- ${agentName}: (no receipts)`);
        continue;
      }
      const latestPath = resolve(sessionDir, "latest.json");
      const raw = existsSync(latestPath) ? readFileSync(latestPath, "utf8") : "";
      const latest = raw.trim() ? JSON.parse(raw) : null;
      if (!latest) {
        blocks.push(`- ${agentName}: (missing latest.json)`);
        continue;
      }
      const injectedLines = latest.injectedLines ?? 0;
      const factsCount = latest.factsCount ?? "?";
      const recallMs = latest.recallMs ?? "?";
      blocks.push(`- ${agentName}: ts=${latest.ts ?? "?"} facts=${factsCount} injectedLines=${injectedLines} recallMs=${recallMs}`);
    }

    const outPath = resolve(memoryReceiptRoot(runDir), "latest.md");
    writeText(outPath, blocks.join("\n"));
  } catch {
    // best effort
  }
}

type MemoryEnv = {
  HINDSIGHT_BASE_URL?: string;
  PROJECT_TAG?: string;
  HINDSIGHT_PROCEDURAL_BANK_ID?: string;
  HINDSIGHT_PERSONAL_BANK_ID?: string;
};

export function memoryExtensionFactory(
  env: MemoryEnv,
  config: GhostyConfig,
  agentName: string,
  sessionId: string,
  paths: { runDir: string },
): ExtensionFactory {
  const baseUrl = env.HINDSIGHT_BASE_URL || config.defaults.runtime?.hindsightBaseUrl || "http://localhost:8888";
  const projectTag = env.PROJECT_TAG || config.defaults.projectTag;
  const memoryDefaults = config.defaults.memory;
  const proceduralBankId =
    env.HINDSIGHT_PROCEDURAL_BANK_ID || memoryDefaults.banks?.procedural?.bankId || "pi-ghosty-procedural";
  const personalBankId =
    env.HINDSIGHT_PERSONAL_BANK_ID || memoryDefaults.banks?.personal?.bankId || "pi-ghosty-personal";
  const hasSplitBanks = Boolean(proceduralBankId && personalBankId);
  const recallCfg = memoryDefaults.recall;
  const retainCfg = memoryDefaults.retain;
  const operationsCfg = memoryDefaults.operations;

  const hindsight = createHindsightClient({
    baseUrl,
    bankId: proceduralBankId,
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

    let turnSeq = 0;
    let activeTurn: {
      turnId: string;
      ts: string;
      sessionId: string;
      agentName: string;
      turnDir: string;
      injectedBlock: string;
      injectedLines: number;
      injectedChars: number;
      factsCount: number | null;
      recallMs: number;
    } | null = null;

    const knownAgents = ["coordinator", "coder", "researcher", "reviewer", "memory"];

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

      const recallTargets = hasSplitBanks
        ? agentName === "coordinator"
          ? [
              { role: "personal", bankId: personalBankId },
              { role: "procedural", bankId: proceduralBankId },
            ]
          : [{ role: "procedural", bankId: proceduralBankId }]
        : [{ role: "procedural", bankId: proceduralBankId }];

      const t0 = performance.now();
      const allLines: string[] = [];
      const recallPayloads: Record<string, any> = {};
      let totalFactsCount = 0;
      const recallErrors: Array<{ role: string; bankId: string; error: string }> = [];

      for (const target of recallTargets) {
        const bankStart = performance.now();
        try {
          const recalled = await hindsight.recall(target.bankId, query, {
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

          recallPayloads[target.role] = recalled;
          const facts: any[] = (recalled as any)?.facts ?? (recalled as any)?.results ?? [];
          const memoryLines = Array.isArray(facts)
            ? facts
                .slice(0, recallCfg.maxFacts)
                .map((f) => (typeof f.text === "string" ? f.text.trim() : null))
                .filter((x): x is string => !!x)
            : [];

          totalFactsCount += Array.isArray(facts) ? facts.length : 0;
          if (memoryLines.length > 0) {
            allLines.push(`memory_${target.role}_bank ${target.bankId}`);
            allLines.push(...memoryLines);
            allLines.push("");
          }

          await trace.append({
            type: "memory_recall",
            projectTag,
            bankId: target.bankId,
            bankRole: target.role,
            agentName,
            sessionId,
            ms: Math.round(performance.now() - bankStart),
            queryLen: query.length,
            estimatedQueryTokensRaw: estimatedBeforeTrim,
            estimatedQueryTokensFinal: shaped.estimatedTokens,
            queryTrimmed: shaped.estimatedTokens < estimatedBeforeTrim,
            queryTimestamp: queryTimestamp ?? null,
            includeSourceFacts: recallCfg.includeSourceFacts,
            includeChunks: recallCfg.includeChunks,
            factsCount: Array.isArray(facts) ? facts.length : null,
            injectedLines: memoryLines.length,
            injectedChars: memoryLines.join("\n").length,
          });
        } catch (err: any) {
          const error = err?.message ?? String(err);
          recallErrors.push({ role: target.role, bankId: target.bankId, error });
          await trace.append({
            type: "memory_recall_error",
            projectTag,
            bankId: target.bankId,
            bankRole: target.role,
            agentName,
            sessionId,
            ms: Math.round(performance.now() - bankStart),
            error,
            estimatedQueryTokensRaw: estimatedBeforeTrim,
            estimatedQueryTokensFinal: shaped.estimatedTokens,
          });
        }
      }

      const t1 = performance.now();
      lastRecallMs = Math.round(t1 - t0);
      const memoryBlock = allLines.join("\n").trim();

      // Human receipts + raw spine
      try {
        const ts = new Date().toISOString();
        const turnId = `${safeTsId(ts)}-t${String(++turnSeq).padStart(4, "0")}`;
        const sessionDir = memoryReceiptSessionDir(paths.runDir, agentName, sessionId);
        const turnDir = resolve(sessionDir, "turns", turnId);
        mkdirSync(turnDir, { recursive: true });

        const injectedBlock = memoryBlock.trim()
          ? `Recalled memory for ${agentName}. These are your durable memories from Hindsight queries.\n${memoryBlock}`
          : recallErrors.length > 0
            ? `(recall error) ${recallErrors.map((e) => `${e.role}:${e.error}`).join(" | ")}`
            : "";
        const injectedLines = memoryBlock.trim() ? memoryBlock.split("\n").length : 0;
        const injectedChars = injectedBlock.length;

        writeJson(resolve(turnDir, "recall.json"), { banks: recallPayloads, errors: recallErrors });
        writeText(resolve(turnDir, "injected.md"), injectedBlock || "(no memory injected)");

        writeJson(resolve(turnDir, "meta.json"), {
          ts,
          turnId,
          agentName,
          sessionId,
          projectTag,
          bankIds: recallTargets.map((t) => ({ role: t.role, bankId: t.bankId })),
          recallMs: lastRecallMs,
          factsCount: totalFactsCount,
          injectedLines,
          injectedChars,
          recallTags,
          queryTimestamp: queryTimestamp ?? null,
          recallErrors,
        });

        const latest = {
          ts,
          turnId,
          turnDir: `turns/${turnId}`,
          agentName,
          sessionId,
          projectTag,
          bankIds: recallTargets.map((t) => ({ role: t.role, bankId: t.bankId })),
          recallMs: lastRecallMs,
          factsCount: totalFactsCount,
          injectedLines,
          injectedChars,
          recallErrors,
        };
        writeJson(resolve(sessionDir, "latest.json"), latest);
        writeText(resolve(sessionDir, "latest-injected.md"), injectedBlock || "(no memory injected)");

        updateMemoryIndex(paths.runDir, knownAgents);

        activeTurn = {
          turnId,
          ts,
          sessionId,
          agentName,
          turnDir,
          injectedBlock,
          injectedLines,
          injectedChars,
          factsCount: totalFactsCount,
          recallMs: lastRecallMs,
        };
      } catch {
        // best effort
      }

      if (!memoryBlock.trim()) return undefined;
      const injected = `${event.systemPrompt}\n\nRecalled memories for ${agentName}. These are durable memories from Hindsight queries.\n${memoryBlock}`;
      return { systemPrompt: injected };
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

      const retainTargets = hasSplitBanks
        ? agentName === "coordinator"
          ? [
              { role: "procedural", bankId: proceduralBankId },
              { role: "personal", bankId: personalBankId },
            ]
          : [{ role: "procedural", bankId: proceduralBankId }]
        : [{ role: "procedural", bankId: proceduralBankId }];

      for (const target of retainTargets) {
        const t0 = performance.now();
        let retainResponse: any;
        let retainTransport: "direct" | "sdk" = "direct";
        try {
          try {
            retainResponse = await retainMemoriesDirect(baseUrl, target.bankId, {
              items: [item],
              async: retainCfg.async,
              ...(retainCfg.updateMode !== "replace" ? { update_mode: retainCfg.updateMode } : {}),
            });
          } catch (directErr: any) {
            retainTransport = "sdk";
            await trace.append({
              type: "memory_retain_update_mode_fallback",
              projectTag,
              bankId: target.bankId,
              bankRole: target.role,
              agentName,
              sessionId,
              updateMode: retainCfg.updateMode,
              error: directErr?.message ?? String(directErr),
            });

            retainResponse = await hindsight.retainBatch(target.bankId, [item as any], {
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
            bankId: target.bankId,
            bankRole: target.role,
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

          try {
            const turn = activeTurn;
            const turnDir = turn?.turnDir ?? (() => {
              const ts = new Date().toISOString();
              const fallbackTurnId = `${safeTsId(ts)}-t${String(++turnSeq).padStart(4, "0")}`;
              const sessionDir = memoryReceiptSessionDir(paths.runDir, agentName, sessionId);
              const dir = resolve(sessionDir, "turns", fallbackTurnId);
              mkdirSync(dir, { recursive: true });
              writeJson(resolve(dir, "meta.json"), {
                ts,
                turnId: fallbackTurnId,
                agentName,
                sessionId,
                projectTag,
                bankIds: retainTargets.map((t) => ({ role: t.role, bankId: t.bankId })),
                note: "retain-only fallback",
              });
              return dir;
            })();

            writeJson(resolve(turnDir, `retain-request-${target.role}.json`), {
              bankId: target.bankId,
              bankRole: target.role,
              baseUrl,
              async: retainCfg.async,
              updateMode: retainCfg.updateMode,
              item,
            });
            writeJson(resolve(turnDir, `retain-response-${target.role}.json`), retainResponse);

            const lines: string[] = [];
            lines.push("\n\n## retain");
            lines.push(`bankRole: ${target.role}`);
            lines.push(`bankId: ${target.bankId}`);
            lines.push(`documentId: ${documentId}`);
            lines.push(`timestamp: ${retainTimestamp}`);
            lines.push(`updateMode: ${retainCfg.updateMode}`);
            lines.push(`async: ${String(retainCfg.async)}`);
            lines.push(`transport: ${retainTransport}`);
            lines.push(`operationIds: ${operationIds.length ? operationIds.join(", ") : "(none)"}`);
            lines.push(`transcriptChars: ${transcript.length}`);
            lines.push("");
            lines.push("raw:");
            lines.push(`- retain-request-${target.role}.json`);
            lines.push(`- retain-response-${target.role}.json`);

            const receiptPath = resolve(turnDir, "receipt.md");
            const baseReceipt = existsSync(receiptPath) ? readFileSync(receiptPath, "utf8") : "";
            const header = baseReceipt.trim()
              ? baseReceipt
              : [
                  "# ghosty memory receipt",
                  `ts: ${new Date().toISOString()}`,
                  `agent: ${agentName}`,
                  `session: ${sessionId}`,
                  `projectTag: ${projectTag}`,
                  `bankIds: ${retainTargets.map((t) => `${t.role}=${t.bankId}`).join(", ")}`,
                  "",
                  "## injected",
                  turn?.injectedBlock?.trim() ? turn.injectedBlock.trim() : "(no memory injected)",
                ].join("\n");

            writeText(receiptPath, header + "\n" + lines.join("\n"));

            const sessionDir = memoryReceiptSessionDir(paths.runDir, agentName, sessionId);
            try {
              const latestPath = resolve(sessionDir, "latest.json");
              const raw = existsSync(latestPath) ? readFileSync(latestPath, "utf8") : "";
              const latest = raw.trim() ? JSON.parse(raw) : {};
              latest.retain = latest.retain || {};
              latest.retain[target.role] = {
                status: "attempted",
                bankId: target.bankId,
                ms: Math.round(t1 - t0),
                documentId,
                retainTimestamp,
                updateMode: retainCfg.updateMode,
                async: retainCfg.async,
                transport: retainTransport,
                operationIds,
              };
              writeJson(latestPath, latest);
            } catch {
              // ignore
            }
          } catch {
            // best effort
          }

          const shouldPollOperations = retainCfg.async && operationIds.length > 0 && (operationsCfg.enabled || retainCfg.waitForCompletion);
          if (shouldPollOperations) {
            const timeoutMs = retainCfg.waitForCompletion ? retainCfg.waitTimeoutMs : operationsCfg.timeoutMs;
            for (const operationId of operationIds) {
              const started = Date.now();
              let finalStatus = "pending";
              let lastError: string | null = null;

              while (Date.now() - started < timeoutMs) {
                try {
                  const status = await getOperationStatusDirect(baseUrl, target.bankId, operationId);
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
                bankId: target.bankId,
                bankRole: target.role,
                agentName,
                sessionId,
                operationId,
                status: timedOut ? "timeout" : finalStatus,
                elapsedMs: Date.now() - started,
                error: lastError,
              });
            }
          }

          await trace.append({
            type: "memory_latency",
            projectTag,
            bankId: target.bankId,
            bankRole: target.role,
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
            bankId: target.bankId,
            bankRole: target.role,
            agentName,
            sessionId,
            ms: Math.round(t1 - t0),
            documentId,
            transcriptChars: transcript.length,
            error: err?.message ?? String(err),
          });
          await trace.append({
            type: "memory_latency",
            projectTag,
            bankId: target.bankId,
            bankRole: target.role,
            agentName,
            sessionId,
            recallMs: lastRecallMs,
            retainMs: Math.round(t1 - t0),
          });
        }
      }
    });

    // Reflect is not wired into pi-ghosty v1 yet. When we add it (manual or scheduled),
    // instrument it with the same timing/size trace shape as retain/recall.
    void hindsight;
  };
}
