import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SessionManager,
  SettingsManager,
  createAgentSessionFromServices,
  createAgentSessionServices,
  defineTool,
} from "@mariozechner/pi-coding-agent";
import { completeSimple } from "@mariozechner/pi-ai";
import type { Model } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { loadExtensionConfigFromFile } from "../../../src/config/loadConfig.js";
import { loadPeerPromptParts } from "../../../src/prompts/loadPeerPromptParts.js";
import {
  buildPeerDelegationPrompt,
  delegateBatchRequestSchema,
  delegateRequestSchema,
  ghostyPeerNames,
  peerOutputSchema,
  routingDecisionSchema,
} from "../../../src/runtime/contracts.js";
import { createPeerReportTool } from "../../../src/runtime/peerReportTool.js";
import { Semaphore } from "../../../src/runtime/concurrency.js";
import { SessionCatalogStore, type CatalogEntry } from "../../../src/runtime/sessionCatalogStore.js";
import { formatSessionName } from "../../../src/runtime/sessionNaming.js";
import { roleSystemPromptExtensionFactory } from "../../../src/extensions/roleSystemPromptExtension.js";
import { samplingExtensionFactory } from "../../../src/extensions/samplingExtension.js";

const GHOSTY_PROMPT_MARKER = "GHOSTY_PROMPT_MARKER_v1";

function getProjectDirFromImportMetaUrl(metaUrl: string): string {
  const extensionDir = dirname(fileURLToPath(metaUrl));
  // <repo>/.pi/extensions/ghosty
  return resolve(extensionDir, "..", "..", "..");
}

function isGhostyExtensionExplicitlyRequested(metaUrl: string): boolean {
  if (process.env.GHOSTY_EXTENSION_ACTIVE === "1") return true;

  const extensionPath = fileURLToPath(metaUrl);
  const argv = process.argv.slice(2);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg !== "-e" && arg !== "--extension") continue;
    const candidate = argv[i + 1];
    if (!candidate) continue;
    if (resolve(process.cwd(), candidate) === extensionPath) return true;
  }

  return false;
}

function lastAssistantText(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== "assistant") continue;
    const content = message?.content;
    if (typeof content === "string" && content.trim()) return content;
    if (Array.isArray(content)) {
      const text = content
        .filter((block: any) => block?.type === "text" && typeof block?.text === "string")
        .map((block: any) => block.text)
        .join("");
      if (text.trim()) return text;
    }
  }
  return "(no assistant text)";
}

function hasPersistedPeerSessions(peerSessionDir: string): boolean {
  try {
    return readdirSync(peerSessionDir).some((name) => name.endsWith(".jsonl"));
  } catch {
    return false;
  }
}

function shellQuote(value: string): string {
  // Minimal POSIX shell quoting suitable for passing a single command string to tmux.
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function extractJsonObject(text: string): string | undefined {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = (fenced?.[1] ?? trimmed).trim();
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return undefined;
  return candidate.slice(first, last + 1);
}

function safeJsonParse<T>(text: string): T | undefined {
  const extracted = extractJsonObject(text) ?? text;
  try {
    return JSON.parse(extracted) as T;
  } catch {
    return undefined;
  }
}

function extractGuidelines(systemPrompt: string): string | null {
  const marker = "\nGuidelines:\n";
  const start = systemPrompt.indexOf(marker);
  if (start < 0) return null;
  const rest = systemPrompt.slice(start + marker.length);
  const end = rest.indexOf("\n\nPi documentation");
  const block = (end >= 0 ? rest.slice(0, end) : rest).trim();
  return block || null;
}

function replaceFirstParagraph(systemPrompt: string, replacement: string): string {
  const normalized = systemPrompt.trimStart();
  const paragraphEnd = normalized.indexOf("\n\n");
  if (paragraphEnd === -1) return replacement;
  const rest = normalized.slice(paragraphEnd).trimStart();
  return `${replacement}\n\n${rest}`;
}

function stripProjectContext(systemPrompt: string): string {
  // Pi injects AGENTS.md/CLAUDE.md/etc. as a "Project Context" section by crawling up directories.
  // For ghosty (personal agent), we deliberately disable this entire injected section.
  const startMarker = "\n# Project Context\n";
  const start = systemPrompt.indexOf(startMarker);
  if (start < 0) return systemPrompt;

  // Keep skills listing and the rest of pi's system prompt.
  const endCandidates = [
    "\n\nThe following skills provide specialized instructions",
    "\n\n<available_skills>",
    "\n\nCurrent date:",
  ];

  let end = -1;
  for (const m of endCandidates) {
    const idx = systemPrompt.indexOf(m, start + startMarker.length);
    if (idx >= 0) {
      end = idx;
      break;
    }
  }

  // If we can't find the end marker, strip to the end.
  if (end < 0) end = systemPrompt.length;

  return (systemPrompt.slice(0, start) + systemPrompt.slice(end)).trimEnd();
}

export default function (pi: any) {
  if (!isGhostyExtensionExplicitlyRequested(import.meta.url)) {
    return;
  }

  const projectDir = getProjectDirFromImportMetaUrl(import.meta.url);
  const rawConfigPath = process.env.GHOSTY_AGENT_CONFIG_PATH?.trim() || "./pi-agent-frontier.json";
  const resolvedConfigPath = resolve(projectDir, rawConfigPath);
  const config = loadExtensionConfigFromFile(resolvedConfigPath);
  const runDir = process.env.GHOSTY_PI_RUN_DIR?.trim() || resolve(homedir(), "runs", "pi-ghosty-pi");
  const appendSystemPath = resolve(projectDir, ".pi", "APPEND_SYSTEM.md");

  samplingExtensionFactory(config, "coordinator", {
    runDir,
    sessionId: "coordinator",
    projectTag: config.defaults.projectTag,
    traceSampling: false,
  })(pi);

  const maxParallelDelegations = config.defaults.routing?.maxParallelDelegations ?? 2;
  const delegationSemaphore = new Semaphore(maxParallelDelegations);

  const catalogStore = new SessionCatalogStore(runDir, config.defaults.projectTag);
  const catalogLoaded = catalogStore.load();

  function inferRoleFromSessionFile(sessionFile: string | null | undefined): string {
    const file = sessionFile ?? "";
    for (const peerName of ghostyPeerNames) {
      const needle = resolve(runDir, "data", "sessions", peerName) + "/";
      if (file.startsWith(needle)) return peerName;
    }
    // Everything else is treated as the coordinator session.
    return "coordinator";
  }

  function applyToolSurface(role: string) {
    const tools = (config.agents?.[role]?.tools ?? []) as string[];
    // Only set tools that are actually registered/known in this pi instance.
    const available = new Set((pi.getAllTools?.() ?? []).map((t: any) => t.name));
    const filtered = tools.filter((t) => available.has(t));
    if (filtered.length > 0) {
      pi.setActiveTools(filtered);
    }
  }

  function removeAll(haystack: string, needle: string): string {
    if (!needle.trim()) return haystack;
    // remove both exact and trimmed occurrences
    return haystack.split(needle).join("");
  }

  function insertAfterFirstParagraph(systemPrompt: string, insertBlock: string): string {
    if (!insertBlock.trim()) return systemPrompt;
    const trimmed = systemPrompt.trimStart();
    const paragraphEnd = trimmed.indexOf("\n\n");
    if (paragraphEnd === -1) return `${trimmed}\n\n${insertBlock}`;
    const head = trimmed.slice(0, paragraphEnd).trimEnd();
    const rest = trimmed.slice(paragraphEnd).trimStart();
    return `${head}\n\n${insertBlock}\n\n${rest}`;
  }

  const sharedAppendText = (() => {
    try {
      if (!existsSync(appendSystemPath)) return "";
      return readFileSync(appendSystemPath, "utf-8").trim();
    } catch {
      return "";
    }
  })();

  const coordinatorPartsText = (() => {
    const parts = loadPeerPromptParts(projectDir, "coordinator");
    return parts.joined.trim();
  })();

  const coordinatorInsertBlock = [
    GHOSTY_PROMPT_MARKER,
    sharedAppendText,
    coordinatorPartsText,
  ]
    .filter((s) => !!s && s.trim())
    .join("\n\n")
    .trim();

  let activeRole = "coordinator";

  // Ensure coordinator does NOT get write/edit/bash unless explicitly allowed.
  // Also ensures peer sessions opened via /peer open get their configured surfaces.
  pi.on?.("session_start", async (_event: any, ctx: any) => {
    const role = inferRoleFromSessionFile(ctx?.sessionManager?.getSessionFile?.());
    activeRole = role;
    applyToolSurface(role);
    const ghostyStatus = ctx.ui?.theme?.fg?.("accent", "ghosty: active") ?? "ghosty: active";
    ctx.ui?.setStatus?.("ghosty", ghostyStatus);
  });

  function computeGhostySystemPrompt(systemPrompt: string, role: string): string {
    let out = stripProjectContext(systemPrompt);

    // First paragraph rewriting for non-coder roles.
    if (role !== "coder") {
      const replacement = (() => {
        if (role === "coordinator") {
          return (
            "You are the coordinator agent for pi-ghosty and the only user-facing agent. " +
            "Your job is to be the user facing agent and use the `delegate` skill/tools (`delegate`, `delegate_batch`) to delegate tasks to specialist peers. " +
            "Use the .pi/skills/delegate/SKILL.md file for guidance. " +
            "Integrate peer results into a final answer for the user."
          );
        }
        if (role === "researcher") {
          return (
            "You are the researcher peer for pi-ghosty (internal; not user-facing). " +
            "Do local repository/system investigation only and report concise, reproducible findings back to the coordinator using the `peer-report` skill. " +
            "Use the .pi/skills/peer-report/SKILL.md file for guidance."
          );
        }
        if (role === "reviewer") {
          return (
            "You are the reviewer peer for pi-ghosty (internal; not user-facing). " +
            "Review proposed changes for correctness, safety, and scope drift, and report concrete issues and a short checklist back to the coordinator."
          );
        }
        if (role === "memory") {
          return (
            "You are the memory peer for pi-ghosty (internal; not user-facing). " +
            "Focus on long-term memory behavior (recall/retain, tags, scopes, observations) and report recommendations back to the coordinator."
          );
        }
        return undefined;
      })();

      if (replacement) {
        const marker = "You are an expert coding assistant operating inside pi";
        const normalized = out.trimStart();
        if (normalized.startsWith(marker)) {
          out = replaceFirstParagraph(out, replacement);
        } else if (!normalized.startsWith(replacement)) {
          out = `${replacement}\n\n${out}`;
        }
      }
    }

    // Coordinator append content (APPEND_SYSTEM + peers/coordinator parts).
    // We want this close to the top (right after the first paragraph), not at the end.
    if (role === "coordinator" && coordinatorInsertBlock) {
      // Normalize: strip any legacy duplicated inserts (with or without marker), then re-insert once.
      out = removeAll(out, GHOSTY_PROMPT_MARKER);
      out = removeAll(out, sharedAppendText);
      out = removeAll(out, coordinatorPartsText);
      out = insertAfterFirstParagraph(out, coordinatorInsertBlock);
    }

    return out;
  }

  // Ensure system prompt has role framing (first paragraph rewrite) and
  // coordinator append content.
  pi.on?.("before_agent_start", (event: any) => {
    if (typeof event?.systemPrompt !== "string") return undefined;
    const computed = computeGhostySystemPrompt(event.systemPrompt, activeRole);
    if (computed === event.systemPrompt) return undefined;
    return { systemPrompt: computed };
  });

  async function askJson(prompt: string, ctx: any): Promise<string> {
    if (!ctx.model) throw new Error("No model selected.");

    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
    if (!auth?.apiKey) throw new Error(`No API key available for provider ${ctx.model.provider}. Run /login ${ctx.model.provider}.`);

    const ac = new AbortController();
    const timeoutMs = 30000;
    const t = setTimeout(() => ac.abort(new Error(`router timeout after ${timeoutMs}ms`)), timeoutMs);

    try {
      const res = await completeSimple(
        ctx.model,
        {
          systemPrompt: "Return strict JSON only.",
          messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
        },
        {
          apiKey: auth.apiKey,
          headers: auth.headers,
          temperature: 0,
          maxTokens: 256,
          signal: ac.signal,
        },
      );

      if (res.stopReason === "error") throw new Error(res.errorMessage || "router error");
      return res.content
        .filter((b: any) => b.type === "text" && typeof b.text === "string")
        .map((b: any) => b.text)
        .join("")
        .trim();
    } finally {
      clearTimeout(t);
    }
  }

  async function maybeEnrichSemantic(entry: CatalogEntry, request: any, reportSummary: string, ctx: any): Promise<CatalogEntry> {
    const cooldownMs = config.defaults.routing?.semantic?.updateCooldownMs ?? 3600000;
    const last = Date.parse(entry.semantic?.updatedAt ?? "");
    const now = Date.now();

    const hasSemantic = !!entry.semantic?.title && !!entry.semantic?.summary && Array.isArray(entry.semantic?.tags);
    const timeStale = !Number.isFinite(last) || now - last > cooldownMs;

    if (hasSemantic && !timeStale) return entry;

    const prompt = [
      "Return strict JSON only.",
      "You are enriching a session catalog entry for routing.",
      "Output schema: {\"title\":string,\"summary\":string,\"tags\":string[]}",
      "",
      `peerName: ${entry.peerName}`,
      `projectTag: ${config.defaults.projectTag}`,
      `cwd: ${entry.cwd}`,
      `task: ${request.task}`,
      `context: ${request.context || ""}`,
      `expectedOutput: ${request.expectedOutput || ""}`,
      `peerReportSummary: ${reportSummary || ""}`,
    ].join("\n");

    const raw = await askJson(prompt, ctx);
    const parsed = safeJsonParse<{ title?: string; summary?: string; tags?: string[] }>(raw);

    if (!parsed?.title || !parsed?.summary || !Array.isArray(parsed.tags)) {
      // Fallback semantic (still update updatedAt so we don't hammer the LLM).
      const task = String(request.task || "").trim().split("\n")[0] || `${entry.peerName} session`;
      const fallback: CatalogEntry["semantic"] = {
        title: task.slice(0, 120),
        summary: (reportSummary || String(request.context || "") || task).trim().slice(0, 1000),
        tags: [entry.peerName, "fallback"],
        updatedAt: new Date().toISOString(),
        source: "llm",
        confidence: "low",
        basis: {
          messageCount: entry.stats?.messageCount,
          toolCalls: entry.stats?.toolCalls,
          compactions: entry.stats?.compactions,
          lastUsedAt: entry.lastUsedAt,
        },
      };
      const updated = { ...entry, semantic: fallback };
      await catalogStore.upsert(entry.peerName, updated);
      return updated;
    }

    const semantic: CatalogEntry["semantic"] = {
      title: String(parsed.title).trim().slice(0, 120),
      summary: String(parsed.summary).trim().slice(0, 1000),
      tags: parsed.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 12),
      updatedAt: new Date().toISOString(),
      source: "llm",
      confidence: "normal",
      basis: {
        messageCount: entry.stats?.messageCount,
        toolCalls: entry.stats?.toolCalls,
        compactions: entry.stats?.compactions,
        lastUsedAt: entry.lastUsedAt,
      },
    };

    const updated = { ...entry, semantic };
    await catalogStore.upsert(entry.peerName, updated);
    return updated;
  }

  const thinkingLevels = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);

  function stripThinkingSuffix(value: string): string {
    const text = String(value || "").trim();
    const i = text.lastIndexOf(":");
    if (i < 0) return text;
    const suffix = text.slice(i + 1).toLowerCase();
    if (!thinkingLevels.has(suffix)) return text;
    return text.slice(0, i).trim();
  }

  function globToRegex(pattern: string): RegExp {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    const regex = `^${escaped.replaceAll("*", ".*").replaceAll("?", ".")}$`;
    return new RegExp(regex, "i");
  }

  function globMatches(pattern: string, value: string): boolean {
    if (!pattern.trim() || !value.trim()) return false;
    return globToRegex(pattern).test(value);
  }

  function modelKey(model: { provider: string; id: string } | null | undefined): string {
    if (!model) return "";
    return `${String(model.provider).toLowerCase()}/${stripThinkingSuffix(String(model.id)).toLowerCase()}`;
  }

  function modelMatchesPattern(model: Model<any>, pattern: string): boolean {
    const normalizedPattern = stripThinkingSuffix(pattern);
    const providerScopedId = modelKey(model);
    const idOnly = stripThinkingSuffix(String(model.id));
    return globMatches(normalizedPattern, providerScopedId) || globMatches(normalizedPattern, idOnly);
  }

  function isModelAllowed(model: Model<any>, patterns: string[]): boolean {
    const activePatterns = patterns.map((p) => p.trim()).filter(Boolean);
    const hasIncludes = activePatterns.some((p) => !p.startsWith("!"));
    let allowed = !hasIncludes;

    for (const pattern of activePatterns) {
      const isExclude = pattern.startsWith("!");
      const body = isExclude ? pattern.slice(1).trim() : pattern;
      if (!body) continue;
      if (!modelMatchesPattern(model, body)) continue;
      allowed = !isExclude;
    }

    return allowed;
  }

  let availableModelsPromise: Promise<Array<Model<any>>> | null = null;
  async function getAvailableModels(ctx: any): Promise<Array<Model<any>>> {
    if (!availableModelsPromise) {
      availableModelsPromise = (async () => {
        try {
          // getAvailable() filters by configured auth.
          const models = await ctx.modelRegistry.getAvailable();
          return models as any;
        } catch {
          return [];
        }
      })();
    }
    return availableModelsPromise;
  }

  async function getAllowedModels(ctx: any): Promise<{ patterns: string[]; available: Array<Model<any>>; allowed: Array<Model<any>> }> {
    const available = await getAvailableModels(ctx);

    let patterns: string[] = [];
    try {
      const settings = SettingsManager.create(ctx.cwd);
      const rawPatterns = settings.getEnabledModels();
      patterns = Array.isArray(rawPatterns) ? rawPatterns.map((p) => String(p).trim()).filter(Boolean) : [];
    } catch {
      patterns = [];
    }

    if (patterns.length === 0) {
      return { patterns, available, allowed: available };
    }

    const allowed = available.filter((m) => isModelAllowed(m, patterns));
    return { patterns, available, allowed };
  }

  async function resolveModelSpec(spec: string, ctx: any): Promise<{ provider: string; id: string } | null> {
    const raw = stripThinkingSuffix((spec || "").trim());
    if (!raw) return null;

    const { allowed, available, patterns } = await getAllowedModels(ctx);
    const pool = patterns.length > 0 ? allowed : available;

    if (raw.includes("/")) {
      const [providerRaw, idRaw] = raw.split("/", 2);
      const provider = providerRaw.trim().toLowerCase();
      const id = stripThinkingSuffix(idRaw);
      if (provider && id) {
        const exact = pool.find((m: any) => modelKey(m) === modelKey({ provider, id }));
        if (exact) return { provider: exact.provider, id: exact.id };
      }
    }

    const provider = String(ctx.model?.provider || "").trim().toLowerCase();
    if (provider) {
      const exact = pool.find((m: any) => String(m.provider).toLowerCase() === provider && stripThinkingSuffix(String(m.id)) === raw);
      if (exact) return { provider: exact.provider, id: exact.id };
    }

    const token = raw.toLowerCase();
    const matches = pool.filter((m: any) =>
      String(m.id).toLowerCase().includes(token) || String(m.name ?? "").toLowerCase().includes(token),
    );

    if (matches.length === 1) {
      return { provider: matches[0].provider, id: matches[0].id };
    }

    return null;
  }

  async function routePeerSession(peerName: string, request: any, ctx: any): Promise<{ sessionManager: SessionManager; sessionState: "new" | "resumed"; requiredModel?: { provider: string; id: string } | null }> {
    const peerSessionDir = resolve(runDir, "data", "sessions", peerName);
    mkdirSync(peerSessionDir, { recursive: true });

    // Model constraint resolution (precedence):
    // 1) explicit request.model
    // 2) peer defaultModel from config
    const peerDefaultModel = (config.agents?.[peerName]?.defaultModel ?? "").trim();
    const requestedModelRaw = String(request?.model ?? "").trim();

    let requiredModel: { provider: string; id: string } | null = null;
    if (requestedModelRaw) {
      requiredModel = await resolveModelSpec(requestedModelRaw, ctx);
      if (!requiredModel) {
        throw new Error(
          `Could not resolve requested model within your scoped models: ${requestedModelRaw}. ` +
            `Adjust /scoped-models (settings.enabledModels) or request an allowed provider/modelId.`,
        );
      }
    } else if (peerDefaultModel) {
      // Default model is best-effort: if it's unknown, fall back to normal routing.
      requiredModel = await resolveModelSpec(peerDefaultModel, ctx);
    }

    // If we have no sessions yet, continueRecent will create one.
    const infos = await SessionManager.list(ctx.cwd, peerSessionDir);
    if (infos.length === 0) {
      return { sessionManager: SessionManager.continueRecent(ctx.cwd, peerSessionDir), sessionState: "new", requiredModel };
    }

    // Build routing candidates from catalog if available.
    await catalogLoaded;
    const maxCandidates = config.defaults.routing?.semantic?.maxCandidates ?? 8;
    let candidates = catalogStore
      .list(peerName as any)
      .filter((e) => !e.status?.retired)
      .sort((a, b) => Date.parse(b.lastUsedAt) - Date.parse(a.lastUsedAt))
      .slice(0, maxCandidates);

    // If a model is required, only consider sessions already on that model.
    if (requiredModel) {
      const key = modelKey(requiredModel);
      candidates = candidates.filter((c: any) => modelKey(c.model) === key);
    }

    // If we don't have enough catalog data yet, default to most recent session.
    if (candidates.length <= 1) {
      if (requiredModel && candidates.length === 0) {
        // Hard constraint: no matching sessions -> start a new one.
        const sm = SessionManager.continueRecent(ctx.cwd, peerSessionDir);
        sm.newSession();
        return { sessionManager: sm, sessionState: "new", requiredModel };
      }

      const mostRecent = [...infos].sort((a: any, b: any) => +b.modified - +a.modified)[0];
      return { sessionManager: SessionManager.open(mostRecent.path, peerSessionDir), sessionState: "resumed", requiredModel };
    }

    const prompt = [
      "Return strict JSON only.",
      "You are routing a delegation request to an existing peer session or creating a new one.",
      "Output schema: {\"action\":\"resume\"|\"new\", \"sessionId\"?:string, \"reason\"?:string, \"confidence\"?:number }",
      "",
      `peerName: ${peerName}`,
      `projectTag: ${config.defaults.projectTag}`,
      `task: ${request.task}`,
      `context: ${request.context || ""}`,
      `requiredModel: ${requiredModel ? modelKey(requiredModel) : "(none)"}`,
      "",
      "Candidates:",
      ...candidates.map((c) => {
        const name = c.sessionName || c.semantic?.title || "(unnamed)";
        const tags = (c.semantic?.tags || []).join(",");
        return `- sessionId=${c.sessionId} lastUsedAt=${c.lastUsedAt} name=${JSON.stringify(name)} tags=${JSON.stringify(tags)} summary=${JSON.stringify((c.semantic?.summary || "").slice(0, 240))}`;
      }),
    ].join("\n");

    try {
      const raw = await askJson(prompt, ctx);
      const parsed = safeJsonParse<any>(raw);
      const decision = routingDecisionSchema.safeParse(parsed);

      if (decision.success && decision.data.action === "resume" && decision.data.sessionId) {
        const chosen = candidates.find((c) => c.sessionId === decision.data.sessionId);
        if (chosen?.sessionFile) {
          return { sessionManager: SessionManager.open(chosen.sessionFile, peerSessionDir), sessionState: "resumed", requiredModel };
        }
      }

      if (decision.success && decision.data.action === "new") {
        const sm = SessionManager.continueRecent(ctx.cwd, peerSessionDir);
        sm.newSession();
        return { sessionManager: sm, sessionState: "new", requiredModel };
      }
    } catch {
      // ignore and fall back
    }

    const mostRecent = [...infos].sort((a: any, b: any) => +b.modified - +a.modified)[0];
    return { sessionManager: SessionManager.open(mostRecent.path, peerSessionDir), sessionState: "resumed", requiredModel };
  }

  async function ensureCatalogEntry(peerName: string, peerSessionManager: SessionManager, ctx: any): Promise<CatalogEntry> {
    await catalogLoaded;

    const peerSessionId = peerSessionManager.getSessionId();
    const now = new Date().toISOString();
    const sessionFile = peerSessionManager.getSessionFile() ?? "";

    const existing = catalogStore.getEntry(peerName as any, peerSessionId);
    if (existing) {
      return (await catalogStore.patch(peerName as any, peerSessionId, {
        lastUsedAt: now,
        sessionFile,
        sessionName: peerSessionManager.getSessionName() ?? existing.sessionName,
      })) as CatalogEntry;
    }

    const entries = peerSessionManager.getEntries();
    const messageCount = entries.filter((e: any) => e.type === "message").length;
    const compactions = entries.filter((e: any) => e.type === "compaction").length;

    const entry: CatalogEntry = {
      peerName: peerName as any,
      sessionId: peerSessionId,
      sessionFile,
      createdAt: now,
      lastUsedAt: now,
      cwd: peerSessionManager.getCwd() ?? ctx.cwd,
      sessionName: peerSessionManager.getSessionName() ?? undefined,
      stats: {
        messageCount,
        compactions,
      },
      semantic: {
        title: `${peerName} session`,
        summary: "(not yet enriched)",
        tags: [peerName],
        updatedAt: new Date(0).toISOString(),
        source: "llm",
        confidence: "low",
        basis: {
          messageCount,
          compactions,
          lastUsedAt: now,
        },
      },
    };

    await catalogStore.upsert(peerName as any, entry);
    return entry;
  }

  async function delegateOnce(request: any, ctx: any) {
    if (!ctx.model) {
      throw new Error("No model selected. Use /model to choose one, or /login if provider auth is required.");
    }

    const parsed = delegateRequestSchema.parse(request);

    const peerSessionDir = resolve(runDir, "data", "sessions", parsed.peerName);
    const { sessionManager: peerSessionManager, sessionState, requiredModel } = await routePeerSession(parsed.peerName, parsed, ctx);
    const peerSessionId = peerSessionManager.getSessionId();

    let entry = await ensureCatalogEntry(parsed.peerName, peerSessionManager, ctx);

    const peerParts = loadPeerPromptParts(projectDir, parsed.peerName);
    const services = await createAgentSessionServices({
      cwd: ctx.cwd,
      resourceLoaderOptions: {
        // Avoid auto-loading extensions from cwd. We only need our role system prompt shaper here.
        noExtensions: true,
        extensionFactories: [
          samplingExtensionFactory(config, parsed.peerName, {
            runDir,
            sessionId: peerSessionId,
            projectTag: config.defaults.projectTag,
            traceSampling: false,
          }),
          roleSystemPromptExtensionFactory(parsed.peerName),
        ],

        // Disable AGENTS.md/CLAUDE.md context-file crawling for peers.
        agentsFilesOverride: (_current) => ({ agentsFiles: [] }),

        appendSystemPrompt: resolve(projectDir, ".pi", "APPEND_SYSTEM.md"),
        additionalSkillPaths: [resolve(projectDir, ".pi", "skills")],
        appendSystemPromptOverride: (base) => {
          const out = [...base];
          if (peerParts.joined.trim()) out.push(peerParts.joined);
          return out;
        },
      },
    });

    const { session } = await createAgentSessionFromServices({
      services,
      sessionManager: peerSessionManager,
      // Do not force the coordinator's model; allow peers to keep their own model by default.
      customTools: [createPeerReportTool()],
    });

    function isModelUnsupportedError(errMsg: string): boolean {
      const s = (errMsg || "").toLowerCase();
      return s.includes("model is not supported") || s.includes("not supported") || s.includes("unsupported");
    }

    // Apply required model (best-effort) while preventing the session from getting wedged.
    // NOTE: SessionManager.setModel() will happily persist model_change even if the upstream
    // later rejects the model. We detect that and revert.
    let modelSwitched = false;
    let previousModel: any = session.model;

    if (requiredModel) {
      const model = ctx.modelRegistry.find(requiredModel.provider, requiredModel.id);
      if (!model) {
        throw new Error(`Unknown model: ${modelKey(requiredModel)}. Use /model to see available models.`);
      }

      if (!ctx.modelRegistry.hasConfiguredAuth(model)) {
        throw new Error(`No auth configured for model ${modelKey(requiredModel)}. Run /login ${requiredModel.provider} or pick a different model.`);
      }

      if (!session.model || session.model.provider !== model.provider || session.model.id !== model.id) {
        await session.setModel(model);
        modelSwitched = true;
      }
    }

    // Enforce per-peer tool surface from extension config.
    // The peer_report tool is always enabled for peers.
    const allowedTools = (config.agents?.[parsed.peerName]?.tools ?? []) as string[];
    session.setActiveToolsByName([...allowedTools, "peer_report"]);

    // Note: model selection is handled via requiredModel routing constraint above.

    const prompt = buildPeerDelegationPrompt(parsed, {
      projectTag: config.defaults.projectTag,
      coordinatorSessionId: ctx.sessionManager.getSessionId(),
      peerSessionId,
      sessionState,
    });

    const before = session.messages.length;
    await session.prompt(prompt, { source: "extension" });

    let newMessages: any[] = session.messages.slice(before);

    // If the prompt failed due to an unsupported model and we switched models, revert and retry once.
    const lastAssistant = [...newMessages].reverse().find((m) => m?.role === "assistant");
    const lastError =
      lastAssistant?.stopReason === "error" && typeof lastAssistant?.errorMessage === "string"
        ? lastAssistant.errorMessage
        : "";

    const hasPeerReport = newMessages.some((m) => m?.role === "toolResult" && m?.toolName === "peer_report");

    if (!hasPeerReport && modelSwitched && lastError && isModelUnsupportedError(lastError) && previousModel) {
      try {
        await session.setModel(previousModel);
        await session.prompt(prompt, { source: "extension" });
        newMessages = session.messages.slice(before);
      } catch {
        // ignore
      }
    }

    let output: any | undefined;
    for (let i = newMessages.length - 1; i >= 0; i--) {
      const m = newMessages[i];
      if (m?.role !== "toolResult" || m?.toolName !== "peer_report") continue;
      const parsedOutput = peerOutputSchema.safeParse(m?.details);
      if (parsedOutput.success) {
        output = parsedOutput.data;
        break;
      }
    }

    if (!output) {
      output = { summary: lastAssistantText(session.messages) };
    }

    // Update stats after the turn and opportunistically enrich semantic info.
    const allEntries = peerSessionManager.getEntries();
    const messageCountAfter = allEntries.filter((e: any) => e.type === "message").length;
    const compactionsAfter = allEntries.filter((e: any) => e.type === "compaction").length;
    entry = (await catalogStore.patch(parsed.peerName as any, peerSessionId, {
      lastUsedAt: new Date().toISOString(),
      model: session.model ? { provider: session.model.provider, id: session.model.id } : undefined,
      stats: {
        messageCount: messageCountAfter,
        compactions: compactionsAfter,
      },
    })) as CatalogEntry;

    let enriched = entry;
    try {
      enriched = await maybeEnrichSemantic(entry, parsed, output.summary, ctx);
    } catch {
      enriched = entry;
    }

    // Always try to set a deterministic session display name.
    try {
      const title = enriched.semantic?.title || `${parsed.peerName} session`;
      const desiredName = formatSessionName(parsed.peerName, title);
      peerSessionManager.appendSessionInfo(desiredName);
      await catalogStore.patch(parsed.peerName as any, peerSessionId, {
        sessionName: desiredName,
      });
    } catch {
      // ignore
    }

    return {
      peerName: parsed.peerName,
      sessionId: peerSessionId,
      sessionState,
      output,
    };
  }

  async function delegateOnceBounded(request: any, ctx: any) {
    return delegationSemaphore.withPermit(() => delegateOnce(request, ctx));
  }

  pi.registerCommand("ghosty", {
    description: "Ghosty extension utilities. Subcommands: status, smoke",
    handler: async (args: string, ctx: any) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const subcommand = (parts[0] || "status").toLowerCase();

      if (subcommand === "status") {
        await catalogLoaded;
        const counts = catalogStore.countByPeer();
        const modelScope = await getAllowedModels(ctx);
        const enabledPatternsText = modelScope.patterns.length > 0 ? modelScope.patterns.join(", ") : "none";

        const lines = [
          "ghosty status",
          `runDir: ${runDir}`,
          `projectTag: ${config.defaults.projectTag}`,
          `configPath: ${resolvedConfigPath}`,
          `enabledModels: ${enabledPatternsText}`,
          `allowedModels: ${modelScope.allowed.length}`,
          `catalog: coder=${counts.coder}, researcher=${counts.researcher}, reviewer=${counts.reviewer}, memory=${counts.memory}`,
          "peer session dirs:",
        ];

        for (const peerName of ghostyPeerNames) {
          const peerDir = resolve(runDir, "data", "sessions", peerName);
          const exists = existsSync(peerDir) && statSync(peerDir).isDirectory();
          lines.push(`- ${peerName}: ${peerDir}${exists ? "" : " (missing)"}`);
        }

        const text = lines.join("\n");
        if (ctx.hasUI) ctx.ui.notify(text, "info");
        else process.stdout.write(`${text}\n`);
        return;
      }

      if (subcommand === "smoke") {
        const result = await delegateOnce(
          {
            peerName: "researcher",
            task: "Call peer_report with summary exactly: smoke test ok",
            expectedOutput: "A peer_report response with summary exactly: smoke test ok",
            // Force the coordinator's current model for smoke so we don't get stuck
            // resuming a peer session wedged on an unsupported model.
            model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
          },
          ctx,
        );

        const text = `ghosty smoke: ${result.output.summary}`;
        if (ctx.hasUI) ctx.ui.notify(text, "info");
        else process.stdout.write(`${text}\n`);
        return;
      }

      const msg = `Unknown subcommand: ${subcommand}. Try: /ghosty status or /ghosty smoke`;
      if (ctx.hasUI) ctx.ui.notify(msg, "warning");
      else process.stdout.write(`${msg}\n`);
    },
  });

  pi.registerCommand("system", {
    description: "Show or dump the current effective system prompt. Usage: /system [dump|guidelines|dump guidelines]",
    handler: async (args: string, ctx: any) => {
      const target = args.trim().toLowerCase();
      const prompt = ctx.getSystemPrompt?.();
      if (!prompt) {
        const msg = "No system prompt available.";
        if (ctx.hasUI) ctx.ui.notify(msg, "warning");
        else process.stdout.write(`${msg}\n`);
        return;
      }

      const isDump = target === "dump" || target === "dump guidelines";
      const isGuidelines = target === "guidelines" || target === "dump guidelines";
      const showPrompt = target === "";

      if (!isDump && !isGuidelines && !showPrompt) {
        const msg = "Usage: /system [dump|guidelines|dump guidelines]";
        if (ctx.hasUI) ctx.ui.notify(msg, "warning");
        else process.stdout.write(`${msg}\n`);
        return;
      }

      // ctx.getSystemPrompt() may return the base prompt when invoked as a command.
      // Show what the next turn will see by applying ghosty transformations.
      const effectivePrompt = computeGhostySystemPrompt(prompt, activeRole);
      const content = isGuidelines ? extractGuidelines(effectivePrompt) ?? "(guidelines section not found)" : effectivePrompt;

      if (isDump) {
        const debugDir = resolve(runDir, "data", "debug");
        mkdirSync(debugDir, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        const prefix = isGuidelines ? "system-guidelines" : "system";
        const outPath = resolve(debugDir, `${prefix}-${ctx.sessionManager.getSessionId()}-${ts}.txt`);
        writeFileSync(outPath, content, "utf8");
        const msg = `Wrote ${outPath}`;
        if (ctx.hasUI) ctx.ui.notify(msg, "info");
        else process.stdout.write(`${msg}\n`);
        return;
      }

      if (ctx.hasUI) {
        await ctx.ui.editor(isGuidelines ? "System guidelines" : "System prompt", content);
      } else {
        process.stdout.write(`${content}\n`);
      }
    },
  });

  pi.registerCommand("peer", {
    description: "Peer utilities. Subcommands: open <peer>",
    handler: async (args: string, ctx: any) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const subcommand = (parts[0] || "open").toLowerCase();

      if (subcommand !== "open") {
        const msg = `Unknown subcommand: ${subcommand}. Try: /peer open <peer>`;
        if (ctx.hasUI) ctx.ui.notify(msg, "warning");
        else process.stdout.write(`${msg}\n`);
        return;
      }

      const peerName = parts[1];
      if (!peerName || !ghostyPeerNames.includes(peerName as any)) {
        const msg = `Usage: /peer open <peer> (one of: ${ghostyPeerNames.join(", ")})`;
        if (ctx.hasUI) ctx.ui.notify(msg, "warning");
        else process.stdout.write(`${msg}\n`);
        return;
      }

      if (!process.env.TMUX) {
        const msg = "Not running inside tmux (TMUX env var not set). Start pi from tmux to use /peer open.";
        if (ctx.hasUI) ctx.ui.notify(msg, "warning");
        else process.stdout.write(`${msg}\n`);
        return;
      }

      const peerSessionDir = resolve(runDir, "data", "sessions", peerName);
      mkdirSync(peerSessionDir, { recursive: true });

      const sessions = await SessionManager.list(ctx.cwd, peerSessionDir);
      if (sessions.length === 0) {
        const msg = `No peer sessions found for ${peerName}. Delegate once first.`;
        if (ctx.hasUI) ctx.ui.notify(msg, "warning");
        else process.stdout.write(`${msg}\n`);
        return;
      }

      const mostRecent = [...sessions].sort((a: any, b: any) => +b.modified - +a.modified)[0];
      const sessionPath = mostRecent.path;

      // Open a new tmux window running pi on the peer session.
      // We pass -e <this extension> so the same tools/commands are available.
      const extPath = fileURLToPath(import.meta.url);
      const cmd =
        `GHOSTY_EXTENSION_ACTIVE=1 ` +
        `GHOSTY_PI_RUN_DIR=${shellQuote(runDir)} ` +
        `GHOSTY_AGENT_CONFIG_PATH=${shellQuote(resolvedConfigPath)} ` +
        `pi --session ${shellQuote(sessionPath)} --session-dir ${shellQuote(peerSessionDir)} -e ${shellQuote(extPath)}`;

      const res = spawnSync("tmux", ["new-window", "-n", peerName, cmd], {
        encoding: "utf8",
      });

      if (res.status !== 0) {
        const msg = `tmux new-window failed (exit ${res.status}): ${(res.stderr || res.stdout || "").trim()}`;
        if (ctx.hasUI) ctx.ui.notify(msg, "error");
        else process.stdout.write(`${msg}\n`);
        return;
      }

      const ok = `Opened tmux window for ${peerName} (${sessionPath})`;
      if (ctx.hasUI) ctx.ui.notify(ok, "info");
      else process.stdout.write(`${ok}\n`);
    },
  });

  pi.registerTool(
    defineTool({
      name: "delegate",
      label: "Delegate Task",
      description: "Delegate work to a specialist peer and return a structured summary.",
      parameters: Type.Object({
        peerName: Type.Union([
          Type.Literal("coder"),
          Type.Literal("researcher"),
          Type.Literal("reviewer"),
          Type.Literal("memory"),
        ]),
        task: Type.String({ minLength: 1 }),
        context: Type.Optional(Type.String()),
        expectedOutput: Type.Optional(Type.String()),
        model: Type.Optional(Type.String({ minLength: 1 })),
      }),
      execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
        const result = await delegateOnceBounded(params, ctx);
        return {
          content: [{ type: "text", text: result.output.summary }],
          details: result,
        };
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: "delegate_batch",
      label: "Delegate Batch",
      description: "Delegate multiple requests to specialist peers with bounded concurrency.",
      parameters: Type.Object({
        requests: Type.Array(
          Type.Object({
            peerName: Type.Union([
              Type.Literal("coder"),
              Type.Literal("researcher"),
              Type.Literal("reviewer"),
              Type.Literal("memory"),
            ]),
            task: Type.String({ minLength: 1 }),
            context: Type.Optional(Type.String()),
            expectedOutput: Type.Optional(Type.String()),
            model: Type.Optional(Type.String({ minLength: 1 })),
          }),
          { minItems: 1 },
        ),
      }),
      execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
        const parsed = delegateBatchRequestSchema.safeParse(params);
        if (!parsed.success) {
          throw new Error(`Invalid delegate_batch request: ${parsed.error.message}`);
        }

        // Partial failures are returned as result objects with an error summary.
        const settled = await Promise.allSettled(
          parsed.data.requests.map((r) => delegateOnceBounded(r, ctx)),
        );

        const results = settled.map((s, i) => {
          if (s.status === "fulfilled") return s.value;
          const peerName = parsed.data.requests[i]?.peerName ?? "researcher";
          return {
            peerName,
            sessionId: "(error)",
            sessionState: "new" as const,
            output: { summary: `delegate_batch error: ${String((s.reason as any)?.message ?? s.reason)}` },
          };
        });

        const summary = results.map((r) => `@${r.peerName}: ${r.output.summary}`).join("\n");
        return {
          content: [{ type: "text", text: summary || "ok" }],
          details: results,
        };
      },
    }),
  );
}
