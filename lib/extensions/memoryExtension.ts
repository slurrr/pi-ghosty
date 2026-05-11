import { estimateTokens, type ExtensionFactory } from "@mariozechner/pi-coding-agent";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { dirname, resolve } from "node:path";
import type { GhostyConfig } from "../config/schema.js";
import {
  bankMemoriesUrl,
  createHindsightClient,
  getBankConfigDirect,
  getHindsightServerCapabilities,
  getOperationStatusDirect,
  retainMemoriesDirect,
  type RetainMemoryItem,
} from "../memory/hindsight.js";
import { JsonlTrace } from "../logging/jsonlTrace.js";

type RetainContentMode = "conversation" | "conversation_with_tools";

type MemoryBankRole = "procedural" | "personal";

type RetainTranscriptEntry = {
  role: string;
  content: string;
  timestamp?: string;
};

type BankAppendState = {
  entryCount: number;
  fullTranscriptSha1: string;
  updatedAt: string;
  documentId: string;
};

type AppendStateFile = Partial<Record<MemoryBankRole, BankAppendState>>;

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .filter((block: any) => block?.type === "text" && typeof block?.text === "string")
    .map((block: any) => block.text)
    .join("")
    .trim();
}

function buildRetainTranscript(messages: AgentMessage[], mode: RetainContentMode): RetainTranscriptEntry[] {
  const entries: RetainTranscriptEntry[] = [];

  for (const message of messages) {
    const m = message as any;
    const role = String(m.role ?? "");
    const timestamp = toIsoTimestamp(m.timestamp);

    if (role === "user" || role === "assistant") {
      const text = extractTextContent(m.content);
      if (!text) continue;
      entries.push({
        role,
        content: text,
        ...(timestamp ? { timestamp } : {}),
      });
      continue;
    }

    if (mode !== "conversation_with_tools") continue;

    if (role === "toolCall") {
      const toolName = String(m.toolName ?? "tool").trim();
      const args = m.args ?? m.arguments ?? m.toolArgs ?? null;
      const argsText = args == null ? "" : typeof args === "string" ? args : JSON.stringify(args);
      const content = argsText.trim() ? `${toolName}: ${argsText}` : toolName;
      if (!content.trim()) continue;
      entries.push({
        role: "tool_call",
        content,
        ...(timestamp ? { timestamp } : {}),
      });
      continue;
    }

    if (role === "toolResult") {
      const toolName = String(m.toolName ?? "tool").trim();
      const text = extractTextContent(m.content);
      if (!text) continue;
      entries.push({
        role: "tool_result",
        content: `${toolName}: ${text}`,
        ...(timestamp ? { timestamp } : {}),
      });
    }
  }

  return entries;
}

function serializeRetainTranscript(messages: AgentMessage[], mode: RetainContentMode): string {
  const entries = buildRetainTranscript(messages, mode);
  return entries.length > 0 ? JSON.stringify(entries) : "";
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

function sha1(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

function memoryReceiptRoot(runDir: string): string {
  return resolve(runDir, "data", "memory", "receipts");
}

function memoryReceiptSessionDir(runDir: string, agentName: string, sessionId: string): string {
  return resolve(memoryReceiptRoot(runDir), agentName, sessionId);
}

function appendStatePath(runDir: string, agentName: string, sessionId: string): string {
  return resolve(memoryReceiptSessionDir(runDir, agentName, sessionId), "append-state.json");
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

function readAppendState(runDir: string, agentName: string, sessionId: string): AppendStateFile {
  try {
    const raw = readFileSync(appendStatePath(runDir, agentName, sessionId), "utf8");
    const parsed = raw.trim() ? JSON.parse(raw) : {};
    return typeof parsed === "object" && parsed ? parsed as AppendStateFile : {};
  } catch {
    return {};
  }
}

function writeAppendState(runDir: string, agentName: string, sessionId: string, state: AppendStateFile): void {
  writeJson(appendStatePath(runDir, agentName, sessionId), state);
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

function renderTagTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(projectTag|agentName|sessionId)\}/g, (_, key) => vars[key] ?? "");
}

function resolveConfiguredTags(templates: string[] | undefined, vars: Record<string, string>, fallback: string[]): string[] {
  if (Array.isArray(templates)) {
    const rendered = templates.map((value) => renderTagTemplate(value, vars).trim()).filter(Boolean);
    return Array.from(new Set(rendered));
  }
  return Array.from(new Set(fallback));
}

function resolveConfiguredScopes(
  scopes: string[][] | undefined,
  vars: Record<string, string>,
  fallback: string[][],
): string[][] {
  const resolved = Array.isArray(scopes)
    ? scopes
        .map((scope) => scope.map((value) => renderTagTemplate(value, vars).trim()).filter(Boolean))
        .filter((scope) => scope.length > 0)
    : [];

  const source = resolved.length > 0 ? resolved : fallback;
  const seen = new Set<string>();
  const unique: string[][] = [];
  for (const scope of source) {
    const key = scope.join("\u0000");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(scope);
  }
  return unique;
}

function dedupeMemoryLines(lines: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const line of lines) {
    const normalized = line.replace(/\s+/g, " ").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(line);
  }
  return unique;
}

function appendPayloadForBank(
  entries: RetainTranscriptEntry[],
  state: BankAppendState | undefined,
): {
  payloadEntries: RetainTranscriptEntry[];
  payloadMode: "delta" | "full";
  appendReady: boolean;
  appendReason: string;
  fullTranscriptSha1: string;
} {
  const fullTranscriptJson = JSON.stringify(entries);
  const fullTranscriptSha1 = sha1(fullTranscriptJson);

  if (!state) {
    return {
      payloadEntries: entries,
      payloadMode: "full",
      appendReady: false,
      appendReason: "missing_append_state",
      fullTranscriptSha1,
    };
  }

  if (entries.length < state.entryCount) {
    return {
      payloadEntries: entries,
      payloadMode: "full",
      appendReady: false,
      appendReason: "entry_count_regressed",
      fullTranscriptSha1,
    };
  }

  const prefixSha1 = sha1(JSON.stringify(entries.slice(0, state.entryCount)));
  if (prefixSha1 !== state.fullTranscriptSha1) {
    return {
      payloadEntries: entries,
      payloadMode: "full",
      appendReady: false,
      appendReason: "prefix_mismatch",
      fullTranscriptSha1,
    };
  }

  const deltaEntries = entries.slice(state.entryCount);
  return {
    payloadEntries: deltaEntries,
    payloadMode: "delta",
    appendReady: true,
    appendReason: deltaEntries.length > 0 ? "delta_ready" : "no_new_entries",
    fullTranscriptSha1,
  };
}

type ResolvedMemoryBank = {
  role: MemoryBankRole;
  bankId: string;
  recallTags: string[];
  retainTags: string[];
  observationScopes: string[][];
  retainContent: RetainContentMode;
};

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

  const tagTemplateVars = { projectTag, agentName, sessionId };
  const legacyRetainTags = [projectTag, `agent:${agentName}`, `session:${sessionId}`];
  const legacyRecallTags = [projectTag, `agent:${agentName}`];
  const legacyObservationScopes = [
    ...(retainCfg.observationScopes.includeProjectScope ? [[projectTag]] : []),
    ...(retainCfg.observationScopes.includeAgentScope ? [[`agent:${agentName}`]] : []),
    ...(retainCfg.observationScopes.includeSessionScope ? [[`session:${sessionId}`]] : []),
  ];

  const resolvedBanks: Record<MemoryBankRole, ResolvedMemoryBank> = {
    procedural: {
      role: "procedural",
      bankId: proceduralBankId,
      recallTags: resolveConfiguredTags(memoryDefaults.banks?.procedural?.recallTags, tagTemplateVars, legacyRecallTags),
      retainTags: resolveConfiguredTags(memoryDefaults.banks?.procedural?.retainTags, tagTemplateVars, legacyRetainTags),
      observationScopes: resolveConfiguredScopes(
        memoryDefaults.banks?.procedural?.observationScopes,
        tagTemplateVars,
        legacyObservationScopes,
      ),
      retainContent: memoryDefaults.banks?.procedural?.retainContent ?? "conversation",
    },
    personal: {
      role: "personal",
      bankId: personalBankId,
      recallTags: resolveConfiguredTags(memoryDefaults.banks?.personal?.recallTags, tagTemplateVars, legacyRecallTags),
      retainTags: resolveConfiguredTags(memoryDefaults.banks?.personal?.retainTags, tagTemplateVars, legacyRetainTags),
      observationScopes: resolveConfiguredScopes(
        memoryDefaults.banks?.personal?.observationScopes,
        tagTemplateVars,
        legacyObservationScopes,
      ),
      retainContent: memoryDefaults.banks?.personal?.retainContent ?? "conversation",
    },
  };
  const trace = JsonlTrace.forAgent(paths.runDir, agentName, sessionId);
  let cachedServerCapabilities:
    | { version?: string; supportsItemUpdateMode: boolean }
    | null = null;

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
      const eventMessages = Array.isArray((event as any)?.messages) ? (event as any).messages : [];
      const rawQuery = String(event.prompt ?? "");
      const queryCharsCapped = recallCfg.queryMaxChars && recallCfg.queryMaxChars > 0
        ? rawQuery.slice(0, recallCfg.queryMaxChars)
        : rawQuery;

      const estimatedBeforeTrim = estimateTextTokens(queryCharsCapped);
      const shaped = truncateToEstimatedTokens(queryCharsCapped, recallCfg.queryMaxTokens);
      const query = shaped.text;

      const queryTimestamp = (() => {
        if (recallCfg.queryTimestampMode === "custom") return recallCfg.queryTimestampValue;
        if (recallCfg.queryTimestampMode === "message") return pickMessageTimestamp(eventMessages, "last");
        if (recallCfg.queryTimestampMode === "session") return pickMessageTimestamp(eventMessages, "first");
        return new Date().toISOString();
      })();

      const recallTargets: ResolvedMemoryBank[] = hasSplitBanks
        ? agentName === "coordinator"
          ? [resolvedBanks.personal, resolvedBanks.procedural]
          : [resolvedBanks.procedural]
        : [resolvedBanks.procedural];

      const t0 = performance.now();
      const allLines: string[] = [];
      const recallPayloads: Record<string, any> = {};
      let totalFactsCount = 0;
      const recallErrors: Array<{ role: string; bankId: string; error: string }> = [];

      for (const target of recallTargets) {
        try {
          const bankStart = performance.now();
          try {
            const recalled = await hindsight.recall(target.bankId, query, {
              maxTokens: recallCfg.maxTokens,
              budget: recallCfg.budget,
              tags: target.recallTags,
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
              ? dedupeMemoryLines(
                  facts
                    .slice(0, recallCfg.maxFacts)
                    .map((f) => (typeof f.text === "string" ? f.text.trim() : null))
                    .filter((x): x is string => !!x),
                )
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
            const isConnectionError = error.includes("fetch failed") || error.includes("ECONNREFUSED") || error.includes("ENOTFOUND");
            recallErrors.push({ role: target.role, bankId: target.bankId, error });
            await trace.append({
              type: isConnectionError ? "memory_recall_connection_error" : "memory_recall_error",
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
        } catch {
          // outer safety
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
          bankIds: recallTargets.map((t) => ({ role: t.role, bankId: t.bankId, recallTags: t.recallTags })),
          recallMs: lastRecallMs,
          factsCount: totalFactsCount,
          injectedLines,
          injectedChars,
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
      const eventMessages = Array.isArray((event as any)?.messages) ? (event as any).messages : [];
      if (eventMessages.length === 0) return;

      const transcriptEntriesByBank: Record<MemoryBankRole, RetainTranscriptEntry[]> = {
        procedural: buildRetainTranscript(eventMessages as AgentMessage[], resolvedBanks.procedural.retainContent),
        personal: buildRetainTranscript(eventMessages as AgentMessage[], resolvedBanks.personal.retainContent),
      };

      const fullContentByBank: Record<MemoryBankRole, string> = {
        procedural: JSON.stringify(transcriptEntriesByBank.procedural),
        personal: JSON.stringify(transcriptEntriesByBank.personal),
      };

      const documentIds: Record<MemoryBankRole, string> = {
        procedural: `${projectTag}/${agentName}/${sessionId}/procedural`,
        personal: `${projectTag}/${agentName}/${sessionId}/personal`,
      };
      const retainTimestamp = (() => {
        if (retainCfg.timestampMode === "none") return "unset";
        if (retainCfg.timestampMode === "message") return pickMessageTimestamp(eventMessages, "last") ?? new Date().toISOString();
        if (retainCfg.timestampMode === "session") return pickMessageTimestamp(eventMessages, "first") ?? new Date().toISOString();
        return new Date().toISOString();
      })();

      const retainTargets: ResolvedMemoryBank[] = hasSplitBanks
        ? agentName === "coordinator"
          ? [resolvedBanks.procedural, resolvedBanks.personal]
          : [resolvedBanks.procedural]
        : [resolvedBanks.procedural];
      const appendState = readAppendState(paths.runDir, agentName, sessionId);

      for (const target of retainTargets) {
        const t0 = performance.now();
        let retainResponse: any;
        const retainTransport: "direct" = "direct";
        const requestedUpdateMode = retainCfg.updateMode;
        let serverCapabilityError: string | null = null;
        if (!cachedServerCapabilities) {
          try {
            cachedServerCapabilities = await getHindsightServerCapabilities(baseUrl);
          } catch (err: any) {
            serverCapabilityError = err?.message ?? String(err);
            cachedServerCapabilities = { supportsItemUpdateMode: false };
          }
        }
        const supportsItemUpdateMode = Boolean(cachedServerCapabilities?.supportsItemUpdateMode);
        const requestUrl = bankMemoriesUrl(baseUrl, target.bankId);
        const requestHeaders = { "content-type": "application/json" };
        const transcriptEntries = transcriptEntriesByBank[target.role];
        const fullContent = fullContentByBank[target.role];
        const documentId = documentIds[target.role];

        if (!fullContent.trim() || fullContent === "[]") continue;

        const appendPlan = appendPayloadForBank(transcriptEntries, appendState[target.role]);
        const actualUpdateMode = supportsItemUpdateMode && requestedUpdateMode === "append" && appendPlan.appendReady
          ? "append"
          : "replace";
        const payloadEntries = actualUpdateMode === "append" ? appendPlan.payloadEntries : transcriptEntries;
        const contentToRetain = JSON.stringify(payloadEntries);
        const effectiveUpdateMode = actualUpdateMode;
        const payloadMode: "delta" | "full" = actualUpdateMode === "append" ? "delta" : "full";
        const payloadReason = actualUpdateMode === "append"
          ? appendPlan.appendReason
          : supportsItemUpdateMode
            ? requestedUpdateMode === "append"
              ? appendPlan.appendReason
              : "requested_replace"
            : "server_no_update_mode_support";

        if (!contentToRetain.trim() || contentToRetain === "[]") {
          if (actualUpdateMode === "append" && appendPlan.appendReason === "no_new_entries") {
            await trace.append({
              type: "memory_retain_skipped_no_delta",
              projectTag,
              bankId: target.bankId,
              bankRole: target.role,
              agentName,
              sessionId,
              documentId,
              requestedUpdateMode,
              payloadReason,
              fullTranscriptEntries: transcriptEntries.length,
            });
          }
          continue;
        }

        const requestItem: RetainMemoryItem = {
          content: contentToRetain,
          timestamp: retainTimestamp,
          document_id: documentId,
          context: retainCfg.context,
          tags: target.retainTags,
          observation_scopes: target.observationScopes.length > 0 ? target.observationScopes : undefined,
          ...(supportsItemUpdateMode ? { update_mode: actualUpdateMode } : {}),
        };
        const requestBody = {
          items: [requestItem],
          async: retainCfg.async,
        };
        const requestBodyJson = JSON.stringify(requestBody);

        let bankConfigSnapshot: any = null;
        let bankConfigError: string | null = null;
        try {
          bankConfigSnapshot = await getBankConfigDirect(baseUrl, target.bankId);
        } catch (err: any) {
          bankConfigError = err?.message ?? String(err);
        }

        try {
          if (requestedUpdateMode !== effectiveUpdateMode) {
            await trace.append({
              type: "memory_retain_update_mode_unsupported",
              projectTag,
              bankId: target.bankId,
              bankRole: target.role,
              agentName,
              sessionId,
              requestedUpdateMode,
              effectiveUpdateMode,
              serverVersion: cachedServerCapabilities?.version ?? null,
              reason: payloadReason,
              serverCapabilityError,
            });
          }

          retainResponse = await retainMemoriesDirect(baseUrl, target.bankId, requestBody);

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
            transcriptChars: contentToRetain.length,
            transcriptSha1: sha1(contentToRetain),
            fullTranscriptChars: fullContent.length,
            fullTranscriptSha1: appendPlan.fullTranscriptSha1,
            fullTranscriptEntries: transcriptEntries.length,
            payloadEntries: payloadEntries.length,
            payloadMode,
            payloadReason,
            tags: target.retainTags,
            retainTransport,
            requestedUpdateMode,
            effectiveUpdateMode,
            retainTimestamp,
            operationIds,
            recallMs: lastRecallMs,
            observationsEnabled: bankConfigSnapshot?.config?.enable_observations ?? null,
            retainExtractionMode: bankConfigSnapshot?.config?.retain_extraction_mode ?? null,
            serverVersion: cachedServerCapabilities?.version ?? null,
            supportsItemUpdateMode,
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
                bankIds: retainTargets.map((t) => ({ role: t.role, bankId: t.bankId, retainTags: t.retainTags })),
                note: "retain-only fallback",
              });
              return dir;
            })();

            writeJson(resolve(turnDir, `retain-request-${target.role}.json`), {
              bankId: target.bankId,
              bankRole: target.role,
              baseUrl,
              requestUrl,
              requestMethod: "POST",
              requestHeaders,
              configuredAsync: retainCfg.async,
              requestedUpdateMode,
              effectiveUpdateMode,
              transcriptChars: contentToRetain.length,
              transcriptSha1: sha1(contentToRetain),
              fullTranscriptChars: fullContent.length,
              fullTranscriptSha1: appendPlan.fullTranscriptSha1,
              fullTranscriptEntries: transcriptEntries.length,
              payloadEntries: payloadEntries.length,
              payloadMode,
              payloadReason,
              documentId,
              retainTags: target.retainTags,
              observationScopes: target.observationScopes,
              retainContent: target.retainContent,
              bankConfigError,
              bankConfigSnapshot,
              serverCapabilityError,
              serverCapabilities: cachedServerCapabilities,
              body: requestBody,
              bodyJson: requestBodyJson,
            });
            writeJson(resolve(turnDir, `retain-response-${target.role}.json`), retainResponse);

            const lines: string[] = [];
            lines.push("\n\n## retain");
            lines.push(`bankRole: ${target.role}`);
            lines.push(`bankId: ${target.bankId}`);
            lines.push(`documentId: ${documentId}`);
            lines.push(`timestamp: ${retainTimestamp}`);
            lines.push(`retainTags: ${target.retainTags.join(", ") || "(none)"}`);
            lines.push(`observationScopes: ${JSON.stringify(target.observationScopes)}`);
            lines.push(`retainContent: ${target.retainContent}`);
            lines.push(`requestedUpdateMode: ${requestedUpdateMode}`);
            lines.push(`effectiveUpdateMode: ${effectiveUpdateMode}`);
            lines.push(`payloadMode: ${payloadMode}`);
            lines.push(`payloadReason: ${payloadReason}`);
            lines.push(`configuredAsync: ${String(retainCfg.async)}`);
            lines.push(`transport: ${retainTransport}`);
            lines.push(`operationIds: ${operationIds.length ? operationIds.join(", ") : "(none)"}`);
            lines.push(`transcriptChars: ${contentToRetain.length}`);
            lines.push(`transcriptSha1: ${sha1(contentToRetain)}`);
            lines.push(`fullTranscriptChars: ${fullContent.length}`);
            lines.push(`fullTranscriptSha1: ${appendPlan.fullTranscriptSha1}`);
            lines.push(`fullTranscriptEntries: ${transcriptEntries.length}`);
            lines.push(`payloadEntries: ${payloadEntries.length}`);
            lines.push(`observationsEnabled: ${String(bankConfigSnapshot?.config?.enable_observations ?? "?")}`);
            lines.push(`retainExtractionMode: ${String(bankConfigSnapshot?.config?.retain_extraction_mode ?? "?")}`);
            lines.push(`serverVersion: ${String(cachedServerCapabilities?.version ?? "?")}`);
            lines.push(`supportsItemUpdateMode: ${String(supportsItemUpdateMode)}`);
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
                requestedUpdateMode,
                effectiveUpdateMode,
                configuredAsync: retainCfg.async,
                transport: retainTransport,
                transcriptChars: contentToRetain.length,
                transcriptSha1: sha1(contentToRetain),
                fullTranscriptChars: fullContent.length,
                fullTranscriptSha1: appendPlan.fullTranscriptSha1,
                fullTranscriptEntries: transcriptEntries.length,
                payloadEntries: payloadEntries.length,
                payloadMode,
                payloadReason,
                retainTags: target.retainTags,
                observationScopes: target.observationScopes,
                retainContent: target.retainContent,
                observationsEnabled: bankConfigSnapshot?.config?.enable_observations ?? null,
                retainExtractionMode: bankConfigSnapshot?.config?.retain_extraction_mode ?? null,
                serverVersion: cachedServerCapabilities?.version ?? null,
                supportsItemUpdateMode,
                operationIds,
              };
              writeJson(latestPath, latest);
            } catch {
              // ignore
            }

            appendState[target.role] = {
              entryCount: transcriptEntries.length,
              fullTranscriptSha1: appendPlan.fullTranscriptSha1,
              updatedAt: new Date().toISOString(),
              documentId,
            };
            writeAppendState(paths.runDir, agentName, sessionId, appendState);
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
          const error = err?.message ?? String(err);
          const isConnectionError = error.includes("fetch failed") || error.includes("ECONNREFUSED") || error.includes("ENOTFOUND");

          await trace.append({
            type: isConnectionError ? "memory_retain_connection_error" : "memory_retain_error",
            projectTag,
            bankId: target.bankId,
            bankRole: target.role,
            agentName,
            sessionId,
            ms: Math.round(t1 - t0),
            documentId,
            transcriptChars: contentToRetain.length,
            error,
          });

          // If connection error, ensure we at least wrote the request to disk for potential recovery
          try {
            const turn = activeTurn;
            if (turn?.turnDir) {
              writeJson(resolve(turn.turnDir, `retain-failed-${target.role}.json`), {
                ts: new Date().toISOString(),
                bankId: target.bankId,
                error,
                isConnectionError,
                transcriptSha1: sha1(contentToRetain),
                requestedUpdateMode,
                effectiveUpdateMode,
                requestUrl,
                requestMethod: "POST",
                requestHeaders,
                requestBody,
                requestBodyJson,
                bankConfigError,
                bankConfigSnapshot,
                serverCapabilityError,
                serverCapabilities: cachedServerCapabilities,
              });
            }
          } catch {
            // ignore
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
        }
      }
    });

    // Reflect is not wired into pi-ghosty v1 yet. When we add it (manual or scheduled),
    // instrument it with the same timing/size trace shape as retain/recall.
    void hindsight;
  };
}
