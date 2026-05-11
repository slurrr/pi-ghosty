import { randomUUID } from "node:crypto";
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
import { Text } from "@mariozechner/pi-tui";
import { loadConfigFromFile } from "../../../lib/config/loadConfig.js";
import { registerVllmProvider } from "../../../lib/config/vllmProvider.js";
import { loadPeerPromptParts } from "../../../lib/prompts/loadPeerPromptParts.js";
import {
  buildPeerDelegationPrompt,
  delegateBatchRequestSchema,
  delegateRequestSchema,
  ghostyPeerNames,
  peerOutputSchema,
  routingDecisionSchema,
  type DelegationLaunch,
  type DelegationReport,
  type PeerOutput,
} from "../../../lib/delegation/contracts.js";
import { delegationReportPath, delegationReportTitle, writeDelegationReport } from "../../../lib/delegation/delegationReports.js";
import { createPeerReportTool } from "../../../lib/delegation/peerReportTool.js";
import { KeyedMutex, Semaphore } from "../../../lib/delegation/concurrency.js";
import { SessionCatalogStore, type CatalogEntry } from "../../../lib/delegation/sessionCatalogStore.js";
import { formatSessionName } from "../../../lib/delegation/sessionNaming.js";
import { modelKey, resolveRoutingDefaults } from "../../../lib/config/rules.js";
import { resolveProjectPresetEnabledModels, setProjectEnabledModels } from "../../../lib/config/projectSettings.js";
import { memoryExtensionFactory } from "../../../lib/extensions/memoryExtension.js";
import { roleSystemPromptExtensionFactory } from "../../../lib/extensions/roleSystemPromptExtension.js";
import { samplingExtensionFactory } from "../../../lib/extensions/samplingExtension.js";
import { progressTraceExtensionFactory } from "../../../lib/extensions/progressTraceExtension.js";
import { JsonlTrace } from "../../../lib/logging/jsonlTrace.js";
import { WorkflowMonitor, getWorkflowMonitor } from "../../../lib/workflow/workflowMonitor.js";
import { lastAssistantText, safeJsonParse, shellQuote } from "../../../lib/utils/helpers.js";
import { registerBrowserTools } from "../../../lib/tools/browser.js";

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


function hasPersistedPeerSessions(peerSessionDir: string): boolean {
  try {
    return readdirSync(peerSessionDir).some((name) => name.endsWith(".jsonl"));
  } catch {
    return false;
  }
}

function resolveGhostyConfigPath(projectDir: string): string {
  const envPath = process.env.GHOSTY_AGENT_CONFIG_PATH?.trim();
  const candidates = [envPath ? resolve(projectDir, envPath) : undefined, resolve(projectDir, "pi-agent.json")].filter(
    (path): path is string => Boolean(path),
  );

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return candidates[0] ?? resolve(projectDir, "pi-agent.json");
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
  const resolvedConfigPath = resolveGhostyConfigPath(projectDir);
  const config = loadConfigFromFile(resolvedConfigPath);
  const runDir = process.env.GHOSTY_PI_RUN_DIR?.trim() || resolve(homedir(), "runs", "pi-ghosty");
  const appendSystemPath = resolve(projectDir, ".pi", "APPEND_SYSTEM.md");
  const workflowMonitor = getWorkflowMonitor({
    projectTag: config.defaults.projectTag,
    runDir,
    agentName: "coordinator",
    config: config.defaults.workflowMonitor,
    onInterrupt: (record) => {
      pi.sendMessage({
        customType: "ghosty-workflow-interrupt",
        content: `GHOSTY WORKFLOW INTERRUPT: ${record.title}\n\nSummary: ${record.summary}\nRecommendation: ${record.recommendation}\nScore: ${record.score} (Threshold: ${config.defaults.workflowMonitor.interruptThreshold})`,
        display: true,
        details: record,
      }, {
        deliverAs: "steer",
        triggerTurn: true,
      });
    }
  });

  const samplingTraceEnabled = (() => {
    const raw = String(process.env.GHOSTY_SAMPLING_TRACE ?? "").trim().toLowerCase();
    return ["1", "true", "yes", "y", "on"].includes(raw);
  })();

  samplingExtensionFactory(config, "coordinator", {
    runDir,
    sessionId: "coordinator",
    projectTag: config.defaults.projectTag,
    traceSampling: samplingTraceEnabled,
  })(pi);

  registerBrowserTools(pi, { runDir });

  const maxParallelDelegations = config.routing.defaults.maxParallelDelegations;
  const delegationSemaphore = new Semaphore(maxParallelDelegations);
  const sessionMutex = new KeyedMutex();
  const busySessionIds = new Set<string>();

  const catalogStore = new SessionCatalogStore(runDir, config.defaults.projectTag);
  const pendingDelegations = new Map<string, any>();
  const delegationMessageRendererType = "ghosty-peer-report";

  function reportTitle(peerName: string, jobId: string): string {
    return delegationReportTitle(peerName, jobId);
  }

  function reportPath(peerName: string, jobId: string, completedAt: string): string {
    return delegationReportPath(runDir, { peerName: peerName as any, jobId, completedAt });
  }

  function formatLaunchMessage(launch: DelegationLaunch): string {
    return [
      `Launched ${launch.title}`,
      `peerName: ${launch.peerName}`,
      `jobId: ${launch.jobId}`,
      `sessionId: ${launch.sessionId}`,
      `sessionState: ${launch.sessionState}`,
      `routing: ${launch.routing ? `${launch.routing.action}${launch.routing.reason ? ` (${launch.routing.reason})` : ""}` : "none"}`,
      "",
      "Delegation message:",
      launch.delegationMessage,
    ].join("\n");
  }

  function formatReportMessage(report: DelegationReport): string {
    const lines = [
      `Peer report ${report.title}`,
      `peerName: ${report.peerName}`,
      `jobId: ${report.jobId}`,
      `sessionId: ${report.peerSessionId}`,
      `sessionState: ${report.sessionState}`,
      `reportSource: ${report.reportSource}`,
      `reportPath: ${report.reportPath}`,
      "",
      "Summary:",
      report.output.summary,
    ];
    if (Array.isArray(report.output.findings) && report.output.findings.length > 0) {
      lines.push("", "Findings:", ...report.output.findings.map((f) => `- ${f}`));
    }
    if (Array.isArray(report.output.next_actions) && report.output.next_actions.length > 0) {
      lines.push("", "Next actions:", ...report.output.next_actions.map((n) => `- ${n}`));
    }
    if (Array.isArray(report.output.artifacts) && report.output.artifacts.length > 0) {
      lines.push("", "Artifacts:", ...report.output.artifacts.map((a) => `- ${a}`));
    }
    if (report.rawText?.trim()) {
      lines.push("", "Raw text:", report.rawText.trim());
    }
    lines.push("", "Delegation message:", report.delegationMessage);
    return lines.join("\n");
  }

  function ensureTraceForSession(sessionId: string): JsonlTrace {
    let trace = traceBySessionId.get(sessionId);
    if (!trace) {
      trace = JsonlTrace.forRuntime(runDir, sessionId);
      traceBySessionId.set(sessionId, trace);
    }
    return trace;
  }

  async function traceEventForSession(sessionId: string, event: Record<string, unknown>): Promise<void> {
    try {
      await ensureTraceForSession(sessionId).append(event);
    } catch {
      // best-effort observability only
    }
  }

  function registerPendingDelegation(job: {
    launch: DelegationLaunch;
    coordinatorSessionId: string;
    peerSessionId: string;
    peerSessionManager: SessionManager;
    request: any;
    prompt: string;
    release: () => void;
    settle: (report: DelegationReport) => void;
    fail: (error: Error) => void;
  }): void {
    pendingDelegations.set(job.launch.jobId, {
      launch: job.launch,
      coordinatorSessionId: job.coordinatorSessionId,
      peerSessionId: job.peerSessionId,
      peerSessionManager: job.peerSessionManager,
      request: job.request,
      prompt: job.prompt,
      release: job.release,
      settled: false,
      completion: Promise.resolve(undefined as unknown as DelegationReport),
      resolve: job.settle,
      reject: job.fail,
    });
  }

  function getPendingDelegation(jobId: string) {
    return pendingDelegations.get(jobId);
  }

  function settleDelegation(jobId: string): boolean {
    const pending = pendingDelegations.get(jobId);
    if (!pending || pending.settled) return false;
    pending.settled = true;
    pending.release();
    pendingDelegations.delete(jobId);
    return true;
  }

  pi.registerMessageRenderer(delegationMessageRendererType, (message: any, options: any, theme: any) => {
    const details = message?.details as DelegationReport | undefined;
    const expanded = !!options?.expanded;
    if (!details) {
      return new Text(theme.fg("error", "ghosty-peer-report: missing details"), 0, 0);
    }

    let text = theme.fg("toolTitle", theme.bold("peer_report ")) + theme.fg("accent", `@${details.peerName}`) + theme.fg("dim", ` job:${details.jobId}`);
    text += "\n" + theme.fg("success", details.output.summary);

    if (expanded) {
      text += "\n" + theme.fg("dim", `sessionId: ${details.peerSessionId}`);
      text += "\n" + theme.fg("dim", `sessionState: ${details.sessionState}`);
      text += "\n" + theme.fg("dim", `reportSource: ${details.reportSource}`);
      text += "\n" + theme.fg("dim", `reportPath: ${details.reportPath}`);
      if (Array.isArray(details.output.findings) && details.output.findings.length > 0) {
        text += "\n\n" + theme.fg("accent", "Findings");
        for (const finding of details.output.findings) text += "\n" + theme.fg("dim", `- ${finding}`);
      }
      if (Array.isArray(details.output.next_actions) && details.output.next_actions.length > 0) {
        text += "\n\n" + theme.fg("accent", "Next actions");
        for (const action of details.output.next_actions) text += "\n" + theme.fg("dim", `- ${action}`);
      }
      if (Array.isArray(details.output.artifacts) && details.output.artifacts.length > 0) {
        text += "\n\n" + theme.fg("accent", "Artifacts");
        for (const artifact of details.output.artifacts) text += "\n" + theme.fg("dim", `- ${artifact}`);
      }
      if (details.rawText?.trim()) {
        text += "\n\n" + theme.fg("warning", "Raw peer text") + "\n" + theme.fg("dim", details.rawText.trim());
      }
      text += "\n\n" + theme.fg("accent", "Delegation message") + "\n" + theme.fg("text", details.delegationMessage.trim());
    }

    return new Text(text, 0, 0);
  });

  const catalogLoaded = catalogStore.load();
  const traceBySessionId = new Map<string, JsonlTrace>();

  function getTrace(ctx: any): JsonlTrace {
    const sid = String(ctx?.sessionManager?.getSessionId?.() ?? "extension");
    let trace = traceBySessionId.get(sid);
    if (!trace) {
      trace = JsonlTrace.forRuntime(runDir, sid);
      traceBySessionId.set(sid, trace);
    }
    return trace;
  }

  async function traceEvent(ctx: any, event: Record<string, unknown>): Promise<void> {
    try {
      await getTrace(ctx).append(event);
    } catch {
      // best-effort observability only
    }
  }

  async function runWorkflowMonitor(reason: string, options?: { force?: boolean }): Promise<void> {
    const enabled = config.defaults.workflowMonitor?.enabled ?? false;
    if (!enabled) return;
    try {
      if (options?.force) {
        await workflowMonitor.run(reason);
      } else {
        await workflowMonitor.maybeRun(reason);
      }
    } catch {
      // best-effort only
    }
  }

  async function renderWorkflowStatus(limit = 5): Promise<string> {
    const latest = await WorkflowMonitor.readLatest(runDir);
    if (!latest) return "ghosty workflow: no summary yet";
    const top = latest.topScreened.slice(0, Math.max(1, limit));
    const lines = [
      "ghosty workflow",
      `updatedAt: ${latest.ts}`,
      `window: ${latest.windowStart} -> ${latest.windowEnd}`,
      `scanned: sources=${latest.sourceCount}, signals=${latest.signalCount}`,
      `screened: winners=${latest.counts.winner}, candidates=${latest.counts.candidate}, parked=${latest.counts.parked}`,
      "top:",
      ...(top.length > 0
        ? top.map(
          (c) => `- ${c.status} ${c.kind}/${c.category} score=${c.score} count=${c.count} title=${c.title} id=${c.id}`,
        )
        : ["- none"]),
    ];
    return lines.join("\n");
  }

  async function renderMemoryInjected(role: string, sessionId: string, full: boolean): Promise<string> {
    const receiptDir = resolve(runDir, "data", "memory", "receipts", role, sessionId);
    const latestPath = resolve(receiptDir, "latest.json");
    const latestRaw = existsSync(latestPath) ? readFileSync(latestPath, "utf8") : "";
    const latest = latestRaw.trim() ? safeJsonParse<any>(latestRaw) : null;

    if (!latest) {
      const fallbackPath = resolve(receiptDir, "latest-injected.md");
      if (existsSync(fallbackPath)) return readFileSync(fallbackPath, "utf8");
      return `ghosty memory: no receipts yet for ${role}/${sessionId}`;
    }

    const turnDir = typeof latest.turnDir === "string" ? resolve(receiptDir, latest.turnDir) : null;
    const injectedPath = turnDir ? resolve(turnDir, "injected.md") : resolve(receiptDir, "latest-injected.md");
    const injected = existsSync(injectedPath) ? readFileSync(injectedPath, "utf8") : "(missing injected block)";

    if (full) {
      return [
        "ghosty memory (injected)",
        `role: ${role}`,
        `session: ${sessionId}`,
        `ts: ${latest.ts ?? "?"}`,
        "",
        injected.trimEnd(),
      ].join("\n");
    }

    const lines = injected.split(/\r?\n/).filter(Boolean);
    const head = lines.slice(0, 20).join("\n");
    const more = lines.length > 20 ? `\n… (${lines.length - 20} more lines. try: /ghosty memory full)` : "";
    return [
      "ghosty memory (injected)",
      `role: ${role}`,
      `session: ${sessionId}`,
      `ts: ${latest.ts ?? "?"}`,
      "",
      head + more,
    ].join("\n");
  }

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

  const memoryEnv = process.env as any;
  const memoryDisabled = (() => {
    const raw = String(process.env.GHOSTY_DISABLE_MEMORY ?? "").trim().toLowerCase();
    return ["1", "true", "yes", "y", "on"].includes(raw);
  })();

  let activeRole = "coordinator";
  const wiredMemorySessions = new Set<string>();

  function wireMemoryExtension(role: string, sessionId: string, piInstance: any) {
    if (wiredMemorySessions.has(sessionId)) return;
    memoryExtensionFactory(memoryEnv, config, role, sessionId, { runDir })(piInstance);
    wiredMemorySessions.add(sessionId);
  }

  // Ensure coordinator does NOT get write/edit/bash unless explicitly allowed.
  // Also ensures peer sessions opened via /peer open get their configured surfaces.
  pi.on?.("session_start", async (event: any, ctx: any) => {
    try {
      await registerVllmProvider(ctx?.modelRegistry, config, process.env.VLLM_BASE_URL || config.defaults.runtime?.vllmBaseUrl);
    } catch {
      // best-effort registration; non-local providers can still run
    }

    const role = inferRoleFromSessionFile(ctx?.sessionManager?.getSessionFile?.());
    activeRole = role;
    applyToolSurface(role);
    const sessionId = ctx?.sessionManager?.getSessionId?.();
    if (sessionId && role === "coordinator" && !memoryDisabled) {
      wireMemoryExtension(role, sessionId, pi);
    }
    const startReason = String(event?.reason ?? "");
    const isFreshSessionStart = startReason === "startup" || startReason === "new" || startReason === "fork";

    // Apply fresh-start defaults for all roles.
    // Resumed sessions must keep the previously selected model.
    if (sessionId && isFreshSessionStart) {
      const persistenceEnabled = config.defaults?.persistence?.enabled ?? false;
      if (!persistenceEnabled) {
        if (role === "coordinator") {
          // Apply hybrid-default preset
          const presets = getModelScopePresets();
          const hybridDefaultFallback = presets["hybrid-default"] ?? ["openai-codex/*", "vllm/*"];
          const hybridDefaultPatterns = resolveProjectPresetEnabledModels(projectDir, "hybrid-default", hybridDefaultFallback);
          try {
            setProjectEnabledModels(projectDir, hybridDefaultPatterns);
          } catch (err: any) {
            ctx.ui?.notify?.(`ghosty: failed to write project enabledModels: ${err?.message ?? String(err)}`, "warning");
          }
        }

        // Set agent default model from config and apply it to the current session.
        const agentDefaultModel = config.agents?.[role]?.defaultModel;
        if (agentDefaultModel) {
          const resolved = await resolveModelSpec(agentDefaultModel, ctx);
          if (resolved) {
            const model = ctx.modelRegistry?.find?.(resolved.provider, resolved.id);
            if (model) {
              const success = await pi.setModel(model);
              if (!success) {
                ctx.ui?.notify?.(`ghosty: could not set ${role} model ${agentDefaultModel}`, "warning");
              }
            }
          }
        }

        const agentThinkingLevel = config.agents?.[role]?.thinkingLevel ?? (role === "coordinator" ? "medium" : "off");
        pi.setThinkingLevel(agentThinkingLevel as any);
      }
    }
    if (sessionId && role === "coordinator") {
      void runWorkflowMonitor("session_start");
    }

    const ghostyStatus = ctx.ui?.theme?.fg?.("accent", "ghosty: active") ?? "ghosty: active";
    ctx.ui?.setStatus?.("ghosty", ghostyStatus);
  });

  pi.on?.("turn_end", async (_event: any, ctx: any) => {
    const role = inferRoleFromSessionFile(ctx?.sessionManager?.getSessionFile?.());
    if (role !== "coordinator") return undefined;
    void runWorkflowMonitor("turn_end");
    return undefined;
  });

  pi.on?.("input", async (_event: any, ctx: any) => {
    const role = inferRoleFromSessionFile(ctx?.sessionManager?.getSessionFile?.());
    if (role !== "coordinator") return undefined;
    void runWorkflowMonitor("heartbeat_input");
    return undefined;
  });

  function computeGhostySystemPrompt(systemPrompt: string, role: string): string {
    let out = stripProjectContext(systemPrompt);

    // First paragraph rewriting for non-coder roles.
    if (role !== "coder") {
      const replacement = (() => {
        if (role === "coordinator") {
          return (
            "I want to have a collaborative 'co-thinking' session with you. " +
            "For this session, please act as a supportive, insightful friend and thinking partner. " +
            "Here is how I’d like us to interact: " +
            "Active Listening: Acknowledge my points before adding your own. " +
            "'Yes, And...': Instead of just giving a final answer, build on my ideas or offer a different perspective to keep the momentum going. " +
            "Ask Questions: Don’t just provide solutions—ask me clarifying questions that help me dig deeper into my own thinking. " +
            "Tone: Keep it conversational, informal, and peer-to-peer."
          );
        }
        if (role === "researcher") {
          return (
            "You are the researcher for an ai engineering team. " +
            "Complete tasks as delegated. Focus on finding relevant information and insights from the web, documentation, and code, and report back concrete findings and summaries to the coordinator. " +
            "Use the .pi/skills/peer-report/SKILL.md file for guidance."
          );
        }
        if (role === "reviewer") {
          return (
            "You are the reviewer peer for an ai engineering team. " +
            "Review proposed changes for correctness, safety, and scope drift, and report concrete issues and a short checklist back to the coordinator."
          );
        }
        if (role === "memory") {
          return (
            "You are the memory peer for an ai engineering team. " +
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

  async function resolveRouterModel(ctx: any): Promise<Model<any>> {
    const routingConfig = resolveRoutingDefaults(config, ctx.model ? { provider: ctx.model.provider, id: ctx.model.id } : null);
    const requested = String(routingConfig.semantic.model || "default").trim();

    if (requested && requested.toLowerCase() !== "default") {
      const resolved = await resolveModelSpec(requested, ctx);
      if (resolved) {
        const model = ctx.modelRegistry.find(resolved.provider, resolved.id);
        if (model) return model;
      }
    }

    if (ctx.model) return ctx.model;
    throw new Error("No model selected.");
  }

  async function askJson(prompt: string, ctx: any): Promise<string> {
    const model = await resolveRouterModel(ctx);

    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    const apiKey = auth?.apiKey || (String(model.provider).toLowerCase() === "vllm" ? "dummy" : "");
    if (!apiKey) throw new Error(`No API key available for provider ${model.provider}. Run /login ${model.provider}.`);

    const ac = new AbortController();
    const timeoutMs = 30000;
    const t = setTimeout(() => ac.abort(new Error(`router timeout after ${timeoutMs}ms`)), timeoutMs);

    try {
      const res = await completeSimple(
        model,
        {
          systemPrompt: "Return strict JSON only.",
          messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
        },
        {
          apiKey,
          headers: auth.headers,
          temperature: 0,
          maxTokens: 256,
          signal: ac.signal,
          onPayload: (payload) => {
            if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
            const out = { ...(payload as Record<string, unknown>) };
            out["response_format"] = { type: "json_object" };
            out["chat_template_kwargs"] = { enable_thinking: false };
            return out;
          },
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
    const cooldownMs = config.routing.defaults.semantic.updateCooldownMs ?? 3600000;
    const last = Date.parse(entry.semantic?.updatedAt ?? "");
    const now = Date.now();

    const hasSemantic = !!entry.semantic?.title && !!entry.semantic?.summary && Array.isArray(entry.semantic?.tags);
    const timeStale = !Number.isFinite(last) || now - last > cooldownMs;

    const basis = entry.semantic?.basis ?? {};
    const msgNow = entry.stats?.messageCount ?? 0;
    const toolNow = entry.stats?.toolCalls ?? 0;
    const compNow = entry.stats?.compactions ?? 0;
    const msgThen = basis.messageCount ?? 0;
    const toolThen = basis.toolCalls ?? 0;
    const compThen = basis.compactions ?? 0;

    const deltaMsgs = msgNow - msgThen;
    const deltaTools = toolNow - toolThen;
    const deltaComp = compNow - compThen;
    const deltaStale = deltaComp >= 1 || deltaMsgs >= 50 || deltaTools >= 15;

    if (hasSemantic && !timeStale && !deltaStale) return entry;

    await traceEvent(ctx, {
      type: "session_semantic_enrich_start",
      sessionId: entry.sessionId,
      peerName: entry.peerName,
      reason: timeStale ? "cooldown" : "delta",
      deltaMsgs,
      deltaTools,
      deltaComp,
    });

    const prompt = [
      "Return strict JSON only.",
      "You are enriching a session catalog entry for routing.",
      "Output schema:",
      '{"title":string,"summary":string,"tags":string[],"weather":{"state":"good|drifting|stale","driftScore":number,"reason":string}}',
      "",
      `peerName: ${entry.peerName}`,
      `projectTag: ${config.defaults.projectTag}`,
      `cwd: ${entry.cwd}`,
      `task: ${request.task}`,
      `context: ${request.context || ""}`,
      `expectedOutput: ${request.expectedOutput || ""}`,
      `peerReportSummary: ${reportSummary || ""}`,
      `currentSummary: ${entry.semantic?.summary || ""}`,
      `deltaMsgs: ${deltaMsgs}`,
      `deltaTools: ${deltaTools}`,
      `deltaCompactions: ${deltaComp}`,
    ].join("\n");

    let raw = "";
    try {
      raw = await askJson(prompt, ctx);
    } catch (err: any) {
      await traceEvent(ctx, {
        type: "session_semantic_enrich_error",
        sessionId: entry.sessionId,
        peerName: entry.peerName,
        error: err?.message ?? String(err),
      });
    }

    const parsed = safeJsonParse<any>(raw);
    const parsedWeather = parsed?.weather ?? {};
    const driftScoreRaw = Number(parsedWeather?.driftScore);
    const driftScore = Number.isFinite(driftScoreRaw) ? Math.max(0, Math.min(1, driftScoreRaw)) : 0;
    const weatherState = parsedWeather?.state === "stale" || parsedWeather?.state === "drifting" || parsedWeather?.state === "good"
      ? parsedWeather.state
      : driftScore >= 0.9
        ? "stale"
        : driftScore >= 0.7
          ? "drifting"
          : "good";

    let semantic: CatalogEntry["semantic"];
    let success = false;

    if (!parsed?.title || !parsed?.summary || !Array.isArray(parsed.tags)) {
      await traceEvent(ctx, {
        type: "session_semantic_enrich_invalid_json",
        sessionId: entry.sessionId,
        peerName: entry.peerName,
        rawLen: raw.length,
        rawExcerpt: raw.slice(0, 400),
      });

      const task = String(request.task || "").trim().split("\n")[0] || `${entry.peerName} session`;
      semantic = {
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
        weather: {
          state: "drifting",
          driftScore: Math.max(0.7, driftScore),
          reason: "fallback semantic parse",
          updatedAt: new Date().toISOString(),
          authority: { level: "advisory" },
        },
      };
    } else {
      semantic = {
        title: String(parsed.title).trim().slice(0, 120),
        summary: String(parsed.summary).trim().slice(0, 1000),
        tags: parsed.tags.map((t: string) => String(t).trim()).filter(Boolean).slice(0, 12),
        updatedAt: new Date().toISOString(),
        source: "llm",
        confidence: "normal",
        basis: {
          messageCount: entry.stats?.messageCount,
          toolCalls: entry.stats?.toolCalls,
          compactions: entry.stats?.compactions,
          lastUsedAt: entry.lastUsedAt,
        },
        weather: {
          state: weatherState,
          driftScore,
          reason: String(parsedWeather?.reason || "advisory").slice(0, 240),
          updatedAt: new Date().toISOString(),
          authority: { level: "advisory" },
        },
      };
      success = true;
    }

    const updated = { ...entry, semantic };
    await catalogStore.upsert(entry.peerName, updated);
    await traceEvent(ctx, {
      type: "session_semantic_enrich_end",
      sessionId: entry.sessionId,
      peerName: entry.peerName,
      success,
    });
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

  function getModelScopePresets(): Record<string, string[]> {
    return config.modelScopePresets ?? {};
  }

  function arraysEqual(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }

  function classifyAllowedModels(allowed: Array<Model<any>>): "local-only" | "frontier-only" | "hybrid" | "custom" {
    const providers = new Set(allowed.map((m) => String(m.provider).toLowerCase()));
    if (providers.size === 0) return "custom";
    if (providers.size === 1) return providers.has("vllm") ? "local-only" : "frontier-only";
    if (providers.has("vllm")) return "hybrid";
    return "frontier-only";
  }

  function providerCounts(models: Array<Model<any>>): string[] {
    const counts = new Map<string, number>();
    for (const model of models) {
      const provider = String(model.provider).toLowerCase();
      counts.set(provider, (counts.get(provider) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([provider, count]) => `- ${provider}: ${count}`);
  }

  async function renderModelsStatus(ctx: any): Promise<string> {
    const modelScope = await getAllowedModels(ctx);
    const presets = getModelScopePresets();
    const matchingPreset = Object.entries(presets).find(([, patterns]) => arraysEqual(patterns, modelScope.patterns));
    const scope = matchingPreset?.[0] ?? classifyAllowedModels(modelScope.allowed);
    const enabledPatternsText = modelScope.patterns.length > 0 ? modelScope.patterns.join(", ") : "none";
    const defaultLines = Object.entries(config.agents)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([agentName, agent]) => {
        const def = (agent.defaultModel ?? "").trim();
        if (!def) return `- ${agentName} -> none`;
        const inScope = modelScope.allowed.some((m) => modelKey(m) === modelKey(resolveModelSpecSyncLike(def, ctx, modelScope.allowed)));
        return `- ${agentName} -> ${def}${inScope ? " (in scope)" : " (out of scope or unresolved)"}`;
      });

    const presetLines = Object.keys(presets).length > 0
      ? Object.entries(presets)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([name, patterns]) => `- ${name}: ${patterns.join(", ") || "none"}`)
      : ["- none configured"];

    return [
      "ghosty models",
      `scope: ${scope}`,
      `enabledModels: ${enabledPatternsText}`,
      `allowedModels: ${modelScope.allowed.length}`,
      "providers:",
      ...providerCounts(modelScope.allowed),
      "role defaults:",
      ...defaultLines,
      "presets:",
      ...presetLines,
    ].join("\n");
  }

  function resolveModelSpecSyncLike(spec: string, ctx: any, pool: Array<Model<any>>): { provider: string; id: string } | null {
    const raw = stripThinkingSuffix((spec || "").trim());
    if (!raw) return null;
    if (raw.includes("/")) {
      const [providerRaw, idRaw] = raw.split("/", 2);
      const provider = providerRaw.trim().toLowerCase();
      const id = stripThinkingSuffix(idRaw);
      const exact = pool.find((m: any) => modelKey(m) === modelKey({ provider, id }));
      if (exact) return { provider: exact.provider, id: exact.id };
    }
    const provider = String(ctx.model?.provider || "").trim().toLowerCase();
    if (provider) {
      const exact = pool.find((m: any) => String(m.provider).toLowerCase() === provider && stripThinkingSuffix(String(m.id)) === raw);
      if (exact) return { provider: exact.provider, id: exact.id };
    }
    const token = raw.toLowerCase();
    const matches = pool.filter((m: any) => String(m.id).toLowerCase().includes(token) || String(m.name ?? "").toLowerCase().includes(token));
    if (matches.length === 1) return { provider: matches[0].provider, id: matches[0].id };
    return null;
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
        if (exact) {
          const resolved = { provider: exact.provider, id: exact.id };
          return resolved;
        }
      }
    }

    const provider = String(ctx.model?.provider || "").trim().toLowerCase();
    if (provider) {
      const exact = pool.find((m: any) => String(m.provider).toLowerCase() === provider && stripThinkingSuffix(String(m.id)) === raw);
      if (exact) {
        const resolved = { provider: exact.provider, id: exact.id };
        return resolved;
      }
    }

    const token = raw.toLowerCase();
    const matches = pool.filter((m: any) =>
      String(m.id).toLowerCase().includes(token) || String(m.name ?? "").toLowerCase().includes(token),
    );

    if (matches.length === 1) {
      const resolved = { provider: matches[0].provider, id: matches[0].id };
      return resolved;
    }

    return null;
  }

  async function routePeerSession(
    peerName: string,
    request: any,
    ctx: any,
  ): Promise<{ sessionManager: SessionManager; sessionState: "new" | "resumed"; routing: { action: "resume" | "new"; reason?: string; confidence?: number } }> {
    const peerSessionDir = resolve(runDir, "data", "sessions", peerName);
    mkdirSync(peerSessionDir, { recursive: true });

    const infos = await SessionManager.list(ctx.cwd, peerSessionDir);
    if (infos.length === 0) {
      await traceEvent(ctx, { type: "session_route_decision", peerName, action: "new", reason: "no sessions" });
      return {
        sessionManager: SessionManager.create(ctx.cwd, peerSessionDir),
        sessionState: "new",
        routing: { action: "new", reason: "no sessions", confidence: 1 },
      };
    }

    await catalogLoaded;
    const routingConfig = resolveRoutingDefaults(config, ctx.model ? { provider: ctx.model.provider, id: ctx.model.id } : null);
    const maxCandidates = routingConfig.semantic.maxCandidates ?? 8;

    const all = catalogStore.list(peerName as any).filter((e) => !e.status?.retired);
    const idle = all.filter((e) => !busySessionIds.has(e.sessionId));
    const base = (idle.length > 0 ? idle : all)
      .sort((a, b) => {
        const aCtx = a.stats?.contextPercent ?? 0;
        const bCtx = b.stats?.contextPercent ?? 0;
        if (aCtx !== bCtx) return aCtx - bCtx;
        const aComp = a.stats?.compactions ?? 0;
        const bComp = b.stats?.compactions ?? 0;
        if (aComp !== bComp) return aComp - bComp;
        return Date.parse(b.lastUsedAt) - Date.parse(a.lastUsedAt);
      })
      .slice(0, maxCandidates);

    const candidates: CatalogEntry[] = [];
    for (const c of base) {
      try {
        candidates.push(await maybeEnrichSemantic(c, request, "", ctx));
      } catch {
        candidates.push(c);
      }
    }

    await traceEvent(ctx, {
      type: "session_route_start",
      peerName,
      candidateCount: candidates.length,
      busyCount: all.length - idle.length,
    });

    const preferredModel = config.agents?.[peerName]?.defaultModel?.trim();
    if (preferredModel) {
      const { allowed, available } = await getAllowedModels(ctx);
      const pool = allowed.length > 0 ? allowed : available;
      const preferredResolved = resolveModelSpecSyncLike(preferredModel, ctx, pool);
      
      const preferredMatch = preferredResolved
        ? idle.find((c) => c.model && modelKey(c.model) === modelKey(preferredResolved) && c.sessionFile)
        : undefined;

      if (preferredMatch?.sessionFile) {
        await traceEvent(ctx, {
          type: "session_route_decision",
          peerName,
          action: "resume",
          chosenSessionId: preferredMatch.sessionId,
          reason: "preferred model match",
        });
        return {
          sessionManager: SessionManager.open(preferredMatch.sessionFile, peerSessionDir),
          sessionState: "resumed",
          routing: { action: "resume", reason: "preferred model match", confidence: 1 },
        };
      }

      const sm = SessionManager.create(ctx.cwd, peerSessionDir);
      await traceEvent(ctx, {
        type: "session_route_decision",
        peerName,
        action: "new",
        reason: "preferred model not found",
      });
      return {
        sessionManager: sm,
        sessionState: "new",
        routing: { action: "new", reason: "preferred model not found", confidence: 1 },
      };
    }

    const sm = SessionManager.create(ctx.cwd, peerSessionDir);
    await traceEvent(ctx, {
      type: "session_route_decision",
      peerName,
      action: "new",
      reason: "no peer default model",
    });
    return {
      sessionManager: sm,
      sessionState: "new",
      routing: { action: "new", reason: "no peer default model", confidence: 1 },
    };
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

  async function launchDelegation(request: any, ctx: any): Promise<{ launch: DelegationLaunch; completion: Promise<DelegationReport> }> {
    if (!ctx.model) {
      throw new Error("No model selected. Use /model to choose one, or /login if provider auth is required.");
    }

    const parsed = delegateRequestSchema.parse(request);
    const coordinatorSessionId = String(ctx.sessionManager.getSessionId?.() ?? "coordinator");
    const { sessionManager: peerSessionManager, sessionState, routing } = await routePeerSession(parsed.peerName, parsed, ctx);
    const peerSessionId = peerSessionManager.getSessionId();
    const jobId = randomUUID();
    const launchedAt = new Date().toISOString();
    const title = reportTitle(parsed.peerName, jobId);
    const delegationMessage = buildPeerDelegationPrompt(parsed, {
      projectTag: config.defaults.projectTag,
      coordinatorSessionId,
      peerSessionId,
      sessionState,
      jobId,
    });

    const launch: DelegationLaunch = {
      title,
      peerName: parsed.peerName,
      jobId,
      sessionId: peerSessionId,
      sessionState,
      delegationMessage,
      routing,
      launchedAt,
    };

    const release = delegationSemaphore.tryAcquire();
    if (!release) {
      throw new Error(`Too many active delegations (max ${maxParallelDelegations}). Try again after one finishes.`);
    }

    try {
      return await sessionMutex.runExclusive(peerSessionId, async () => {
        if (busySessionIds.has(peerSessionId)) {
          throw new Error(`Peer session ${peerSessionId} is already busy`);
        }

        busySessionIds.add(peerSessionId);
        let entry = await ensureCatalogEntry(parsed.peerName, peerSessionManager, ctx);

        const peerParts = loadPeerPromptParts(projectDir, parsed.peerName);
        const services = await createAgentSessionServices({
          cwd: ctx.cwd,
          resourceLoaderOptions: {
            noExtensions: true,
            extensionFactories: [
              samplingExtensionFactory(config, parsed.peerName, {
                runDir,
                sessionId: peerSessionId,
                projectTag: config.defaults.projectTag,
                traceSampling: samplingTraceEnabled,
              }),
              progressTraceExtensionFactory({
                runDir,
                sessionId: peerSessionId,
                projectTag: config.defaults.projectTag,
                agentName: parsed.peerName,
              }),
              ...(memoryDisabled ? [] : [memoryExtensionFactory(memoryEnv, config, parsed.peerName, peerSessionId, { runDir })]),
              roleSystemPromptExtensionFactory(parsed.peerName),
            ],
            agentsFilesOverride: (_current) => ({ agentsFiles: [] }),
            appendSystemPrompt: [resolve(projectDir, ".pi", "APPEND_SYSTEM.md")] as any,
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
          customTools: [
            createPeerReportTool(async (output) => {
              const pending = pendingDelegations.get(jobId);
              if (!pending?.finalize) return;
              await pending.finalize(output, "tool");
            }),
          ],
        });

        const allowedTools = (config.agents?.[parsed.peerName]?.tools ?? []) as string[];
        session.setActiveToolsByName([...allowedTools, "peer_report"]);

        const before = session.messages.length;
        const peerProgressTrace = JsonlTrace.forAgent(runDir, parsed.peerName, peerSessionId);
        const promptStartedAt = Date.now();
        let progressTimer: ReturnType<typeof setInterval> | null = null;

        let resolveCompletion!: (report: DelegationReport) => void;
        let rejectCompletion!: (error: Error) => void;
        const completion = new Promise<DelegationReport>((resolve, reject) => {
          resolveCompletion = resolve;
          rejectCompletion = reject;
        });

        const finalize = async (output: PeerOutput, reportSource: "tool" | "text", rawText?: string): Promise<DelegationReport> => {
          const pending = pendingDelegations.get(jobId);
          if (!pending) return completion;
          if (pending.settled) return completion;
          pending.settled = true;
          if (progressTimer) {
            clearInterval(progressTimer);
            progressTimer = null;
          }

          try {
            await peerProgressTrace.append({
              type: "delegate_progress",
              projectTag: config.defaults.projectTag,
              agentName: parsed.peerName,
              sessionId: peerSessionId,
              jobId,
              phase: "completed",
              elapsedSec: Math.max(0, Math.round((Date.now() - promptStartedAt) / 1000)),
              reportSource,
            });
          } catch {
            // best-effort observability only
          }

          const completedAt = new Date().toISOString();
          let report: DelegationReport = {
            ...launch,
            coordinatorSessionId,
            peerSessionId,
            reportSource,
            rawText,
            output,
            reportPath: reportPath(parsed.peerName, jobId, completedAt),
            completedAt,
          };

          try {
            report.reportPath = writeDelegationReport(runDir, report);
          } catch (err: any) {
            await traceEventForSession(coordinatorSessionId, {
              type: "delegate_report_write_error",
              peerName: parsed.peerName,
              jobId,
              error: err?.message ?? String(err),
            });
          }

          try {
            const stats = session.getSessionStats();
            const contextUsage: any = session.getContextUsage();
            const compactionsAfter = peerSessionManager.getEntries().filter((e: any) => e.type === "compaction").length;
            entry = (await catalogStore.patch(parsed.peerName as any, peerSessionId, {
              lastUsedAt: new Date().toISOString(),
              model: session.model ? { provider: session.model.provider, id: session.model.id } : undefined,
              stats: {
                messageCount: stats.totalMessages,
                toolCalls: stats.toolCalls,
                contextPercent: typeof contextUsage?.percent === "number" ? contextUsage.percent : null,
                compactions: compactionsAfter,
              },
            })) as CatalogEntry;

            let enriched = entry;
            try {
              enriched = await maybeEnrichSemantic(entry, parsed, output.summary, ctx);
            } catch {
              enriched = entry;
            }

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
          } catch (err: any) {
            await traceEventForSession(coordinatorSessionId, {
              type: "delegate_postprocess_error",
              peerName: parsed.peerName,
              jobId,
              error: err?.message ?? String(err),
            });
          }

          await traceEventForSession(coordinatorSessionId, {
            type: "delegate_end",
            peerName: parsed.peerName,
            sessionId: peerSessionId,
            jobId,
            routingAction: routing.action,
            reportSource,
          });

          try {
            pi.sendMessage(
              {
                customType: delegationMessageRendererType,
                content: formatReportMessage(report),
                display: true,
                details: report,
              },
              { triggerTurn: true, deliverAs: "followUp" },
            );
          } catch (err: any) {
            await traceEventForSession(coordinatorSessionId, {
              type: "delegate_report_injection_error",
              peerName: parsed.peerName,
              jobId,
              error: err?.message ?? String(err),
            });
          }

          try {
            pending.resolve(report);
          } finally {
            busySessionIds.delete(peerSessionId);
            release();
            pendingDelegations.delete(jobId);
          }

          return report;
        };

        const pending = {
          launch,
          coordinatorSessionId,
          peerSessionId,
          peerSessionManager,
          request: parsed,
          prompt: delegationMessage,
          release,
          settled: false,
          completion,
          resolve: resolveCompletion,
          reject: rejectCompletion,
          finalize,
        };
        pendingDelegations.set(jobId, pending);

        await traceEvent(ctx, {
          type: "delegate_start",
          peerName: parsed.peerName,
          sessionId: peerSessionId,
          jobId,
          routingAction: routing.action,
        });

        try {
          await peerProgressTrace.append({
            type: "delegate_progress",
            projectTag: config.defaults.projectTag,
            agentName: parsed.peerName,
            sessionId: peerSessionId,
            jobId,
            phase: "started",
            routingAction: routing.action,
          });
        } catch {
          // best-effort observability only
        }

        progressTimer = setInterval(() => {
          void peerProgressTrace.append({
            type: "delegate_progress",
            projectTag: config.defaults.projectTag,
            agentName: parsed.peerName,
            sessionId: peerSessionId,
            jobId,
            phase: "running",
            elapsedSec: Math.max(0, Math.round((Date.now() - promptStartedAt) / 1000)),
          }).catch(() => {
            // best-effort observability only
          });
        }, 10000);

        const promptPromise = session.prompt(delegationMessage, { source: "extension" });
        promptPromise
          .then(async () => {
            const current = pendingDelegations.get(jobId);
            if (!current || current.settled) return;

            const newMessages: any[] = session.messages.slice(before);
            let output: PeerOutput | undefined;
            let reportSource: "tool" | "text" = "text";
            for (let i = newMessages.length - 1; i >= 0; i--) {
              const m = newMessages[i];
              if (m?.role !== "toolResult" || m?.toolName !== "peer_report") continue;
              const parsedOutput = peerOutputSchema.safeParse(m?.details);
              if (parsedOutput.success) {
                output = parsedOutput.data;
                reportSource = "tool";
                break;
              }
            }

            if (!output) {
              output = { summary: lastAssistantText(session.messages) };
            }

            await current.finalize(output, reportSource);
          })
          .catch(async (err: any) => {
            const current = pendingDelegations.get(jobId);
            if (!current || current.settled) return;
            const message = err?.message ?? String(err);
            try {
              await peerProgressTrace.append({
                type: "delegate_progress",
                projectTag: config.defaults.projectTag,
                agentName: parsed.peerName,
                sessionId: peerSessionId,
                jobId,
                phase: "failed",
                elapsedSec: Math.max(0, Math.round((Date.now() - promptStartedAt) / 1000)),
                error: message,
              });
            } catch {
              // best-effort observability only
            }
            await current.finalize({ summary: `delegation failed: ${message}` }, "text", message);
          });

        return {
          launch,
          completion,
        };
      });
    } catch (err) {
      busySessionIds.delete(peerSessionId);
      release();
      throw err;
    }
  }

  async function delegateOnce(request: any, ctx: any) {
    const result = await launchDelegation(request, ctx);
    return result.launch;
  }

  async function delegateOnceBounded(request: any, ctx: any) {
    return launchDelegation(request, ctx);
  }

  pi.registerCommand("ghosty", {
    description: "Ghosty extension utilities. Subcommands: status, models, workflow, smoke, system, peer",
    handler: async (args: string, ctx: any) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const subcommand = (parts[0] || "status").toLowerCase();

      if (subcommand === "status") {
        await catalogLoaded;
        const counts = catalogStore.countByPeer();
        const modelScope = await getAllowedModels(ctx);
        const enabledPatternsText = modelScope.patterns.length > 0 ? modelScope.patterns.join(", ") : "none";

        const routingDefaults = resolveRoutingDefaults(config, ctx.model ? { provider: ctx.model.provider, id: ctx.model.id } : null);
        const workflowLatest = await WorkflowMonitor.readLatest(runDir);
        const lines = [
          "ghosty status",
          `runDir: ${runDir}`,
          `projectTag: ${config.defaults.projectTag}`,
          `configPath: ${resolvedConfigPath}`,
          `enabledModels: ${enabledPatternsText}`,
          `allowedModels: ${modelScope.allowed.length}`,
          `routing.semantic.model: ${routingDefaults.semantic.model}`,
          `workflowMonitor: ${config.defaults.workflowMonitor.enabled ? "on" : "off"}`,
          `workflowTop: ${workflowLatest ? `winners=${workflowLatest.counts.winner}, candidates=${workflowLatest.counts.candidate}` : "none"}`,
          `busySessions: ${busySessionIds.size}`,
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

      if (subcommand === "models") {
        const action = (parts[1] || "status").toLowerCase();
        if (action === "status" || action === "show") {
          const text = await renderModelsStatus(ctx);
          if (ctx.hasUI) ctx.ui.notify(text, "info");
          else process.stdout.write(`${text}\n`);
          return;
        }

        if (action === "preset") {
          const presetName = parts[2];
          if (!presetName) {
            const msg = "Usage: /ghosty models preset <name>";
            if (ctx.hasUI) ctx.ui.notify(msg, "warning");
            else process.stdout.write(`${msg}\n`);
            return;
          }

          const presets = getModelScopePresets();
          const patterns = presets[presetName];
          if (!patterns) {
            const msg = `Unknown preset: ${presetName}. Available: ${Object.keys(presets).sort().join(", ") || "none"}`;
            if (ctx.hasUI) ctx.ui.notify(msg, "warning");
            else process.stdout.write(`${msg}\n`);
            return;
          }

          const resolvedPatterns = resolveProjectPresetEnabledModels(projectDir, presetName, patterns);

          try {
            setProjectEnabledModels(projectDir, resolvedPatterns);
          } catch (err: any) {
            const msg = `ghosty: failed to write project enabledModels: ${err?.message ?? String(err)}`;
            if (ctx.hasUI) ctx.ui.notify(msg, "warning");
            else process.stdout.write(`${msg}\n`);
            return;
          }
          const text = `Applied preset ${presetName}: ${resolvedPatterns.join(", ") || "none"}`;
          if (ctx.hasUI) ctx.ui.notify(text, "info");
          else process.stdout.write(`${text}\n`);
          return;
        }

        const msg = "Usage: /ghosty models [status|preset <name>]";
        if (ctx.hasUI) ctx.ui.notify(msg, "warning");
        else process.stdout.write(`${msg}\n`);
        return;
      }

      if (subcommand === "workflow") {
        const limitRaw = Number(parts[1]);
        const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(20, Math.trunc(limitRaw)) : 5;
        await runWorkflowMonitor("command_workflow", { force: true });
        const text = await renderWorkflowStatus(limit);
        if (ctx.hasUI) {
          await ctx.ui.editor("Workflow monitor", text);
        } else {
          process.stdout.write(`${text}\n`);
        }
        return;
      }

      if (subcommand === "memory") {
        const arg = (parts[1] || "").toLowerCase();
        const full = arg === "full";
        const role = inferRoleFromSessionFile(ctx?.sessionManager?.getSessionFile?.());
        const sessionId = String(ctx?.sessionManager?.getSessionId?.() ?? "");
        if (!sessionId) {
          const msg = "ghosty memory: no session id";
          if (ctx.hasUI) ctx.ui.notify(msg, "warning");
          else process.stdout.write(`${msg}\n`);
          return;
        }
        const text = await renderMemoryInjected(role, sessionId, full);
        if (ctx.hasUI) {
          await ctx.ui.editor("Memory injected", text);
        } else {
          process.stdout.write(`${text}\n`);
        }
        return;
      }

      if (subcommand === "smoke") {
        const { completion } = await launchDelegation(
          {
            peerName: "researcher",
            task: "Call peer_report with summary exactly: smoke test ok",
            expectedOutput: "A peer_report response with summary exactly: smoke test ok",
          },
          ctx,
        );
        const result = await completion;

        const text = `ghosty smoke: ${result.output.summary}`;
        if (ctx.hasUI) ctx.ui.notify(text, "info");
        else process.stdout.write(`${text}\n`);
        return;
      }

      if (subcommand === "system") {
        const target = parts.slice(1).join(" ").trim().toLowerCase();
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
          const msg = "Usage: /ghosty system [dump|guidelines|dump guidelines]";
          if (ctx.hasUI) ctx.ui.notify(msg, "warning");
          else process.stdout.write(`${msg}\n`);
          return;
        }

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
        return;
      }

      if (subcommand === "peer") {
        const peerArgs = parts.slice(1);
        const peerSubcommand = (peerArgs[0] || "open").toLowerCase();

        if (peerSubcommand === "workflow") {
          const limitRaw = Number(peerArgs[1]);
          const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(20, Math.trunc(limitRaw)) : 5;
          await runWorkflowMonitor("command_peer_workflow", { force: true });
          const text = await renderWorkflowStatus(limit);
          if (ctx.hasUI) {
            await ctx.ui.editor("Workflow monitor", text);
          } else {
            process.stdout.write(`${text}\n`);
          }
          return;
        }

        if (peerSubcommand !== "open") {
          const msg = `Unknown subcommand: ${peerSubcommand}. Try: /ghosty peer open <peer> or /ghosty peer workflow [limit]`;
          if (ctx.hasUI) ctx.ui.notify(msg, "warning");
          else process.stdout.write(`${msg}\n`);
          return;
        }

        const peerName = peerArgs[1];
        if (!peerName || !ghostyPeerNames.includes(peerName as any)) {
          const msg = `Usage: /ghosty peer open <peer> (one of: ${ghostyPeerNames.join(", ")})`;
          if (ctx.hasUI) ctx.ui.notify(msg, "warning");
          else process.stdout.write(`${msg}\n`);
          return;
        }

        if (!process.env.TMUX) {
          const msg = "Not running inside tmux (TMUX env var not set). Start pi from tmux to use /ghosty peer open.";
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
        const extPath = fileURLToPath(import.meta.url);
        const workdirMode = process.env.GHOSTY_WORKDIR_MODE?.trim() || "sandbox";
        const projectDirEnv = process.env.GHOSTY_PROJECT_DIR?.trim() || projectDir;
        const trustedPrefix = workdirMode === "trusted" ? `cd ${shellQuote(projectDirEnv)} && ` : "";
        const cmd =
          `${trustedPrefix}` +
          `GHOSTY_EXTENSION_ACTIVE=1 ` +
          `GHOSTY_PROJECT_DIR=${shellQuote(projectDirEnv)} ` +
          `GHOSTY_WORKDIR_MODE=${shellQuote(workdirMode)} ` +
          `GHOSTY_PI_RUN_DIR=${shellQuote(runDir)} ` +
          `GHOSTY_AGENT_CONFIG_PATH=${shellQuote(resolvedConfigPath)} ` +
          `pi --session ${shellQuote(sessionPath)} --session-dir ${shellQuote(peerSessionDir)} -e ${shellQuote(extPath)}`;

        const logDir = resolve(runDir, "data", "traces", peerName);
        mkdirSync(logDir, { recursive: true });
        const logPath = resolve(logDir, `${mostRecent.id}.jsonl`);
        if (!existsSync(logPath)) writeFileSync(logPath, "");

        const logCmd = `tail -n 50 -f ${shellQuote(logPath)} | sed 's/\\\\n/\\n/g'`;

        // Attempt "War Room" layout: Split vertically for peer, then split the new pane horizontally for logs.
        const res = spawnSync("tmux", ["split-window", "-h", "-p", "50", cmd], {
          encoding: "utf8",
        });

        if (res.status === 0) {
          spawnSync("tmux", ["split-window", "-v", "-p", "30", logCmd], {
            encoding: "utf8",
          });
          const ok = `Opened War Room for ${peerName} (session: ${mostRecent.id})`;
          if (ctx.hasUI) ctx.ui.notify(ok, "info");
          else process.stdout.write(`${ok}\n`);
        } else {
          // Fallback to new-window if split fails (e.g. pane too small)
          const fallback = spawnSync("tmux", ["new-window", "-n", peerName, cmd], {
            encoding: "utf8",
          });
          if (fallback.status !== 0) {
            const msg = `tmux failed (exit ${fallback.status}): ${(fallback.stderr || fallback.stdout || "").trim()}`;
            if (ctx.hasUI) ctx.ui.notify(msg, "error");
            else process.stdout.write(`${msg}\n`);
          } else {
            const ok = `Opened tmux window for ${peerName} (fallback)`;
            if (ctx.hasUI) ctx.ui.notify(ok, "info");
            else process.stdout.write(`${ok}\n`);
          }
        }
        return;
      }

      const msg = `Unknown subcommand: ${subcommand}. Try: /ghosty status, /ghosty models, /ghosty workflow, /ghosty smoke, /ghosty system, or /ghosty peer`;
      if (ctx.hasUI) ctx.ui.notify(msg, "warning");
      else process.stdout.write(`${msg}\n`);
    },
  });


  pi.registerTool(
    defineTool({
      name: "delegate",
      label: "Delegate Task",
      description: "Delegate work to a specialist peer and launch it without blocking the coordinator.",
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
      }),
      renderCall: (args, theme, context) => {
        const peerName = String((args as any)?.peerName ?? "?");
        const task = String((args as any)?.task ?? "").trim();
        const firstLine = task.split("\n")[0] ?? "";

        let text = theme.fg("toolTitle", theme.bold("delegate "));
        text += theme.fg("accent", `@${peerName}`);
        if (firstLine) text += theme.fg("muted", " — ") + theme.fg("text", firstLine);

        if (!context.expanded) return new Text(text, 0, 0);

        const ctxText = String((args as any)?.context ?? "").trim();
        const expected = String((args as any)?.expectedOutput ?? "").trim();

        if (task) text += "\n\n" + theme.fg("accent", "Task") + "\n" + theme.fg("text", task);
        if (ctxText) text += "\n\n" + theme.fg("accent", "Context") + "\n" + theme.fg("text", ctxText);
        if (expected) text += "\n\n" + theme.fg("accent", "Expected Output") + "\n" + theme.fg("text", expected);

        return new Text(text, 0, 0);
      },
      renderResult: (result, { expanded, isPartial }, theme) => {
        if (isPartial) return new Text(theme.fg("warning", "Launching..."), 0, 0);

        const details = result.details as DelegationLaunch | undefined;
        if (!details) return new Text(theme.fg("error", "delegate: missing launch details"), 0, 0);

        let text = theme.fg("success", `${details.title} launched`);
        text += "\n" + theme.fg("dim", `peerName: @${details.peerName}`);
        text += "\n" + theme.fg("dim", `jobId: ${details.jobId}`);
        text += "\n" + theme.fg("dim", `sessionId: ${details.sessionId}`);
        text += "\n" + theme.fg("dim", `sessionState: ${details.sessionState}`);
        if (details.routing) {
          text += "\n" + theme.fg("dim", `routing: ${details.routing.action}${details.routing.reason ? ` (${details.routing.reason})` : ""}`);
        }
        text += "\n" + theme.fg("warning", "Peer launched; completion will arrive asynchronously.");

        if (expanded) {
          text += "\n\n" + theme.fg("accent", "Delegation message") + "\n" + theme.fg("text", details.delegationMessage);
        }

        return new Text(text, 0, 0);
      },
      execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
        const result = await delegateOnceBounded(params, ctx);
        return {
          content: [{ type: "text", text: formatLaunchMessage(result.launch) }],
          details: result.launch,
        };
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: "delegate_batch",
      label: "Delegate Batch",
      description: "Delegate multiple requests to specialist peers and launch them without blocking.",
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
          }),
          { minItems: 1 },
        ),
      }),
      renderCall: (args, theme, context) => {
        const requests = Array.isArray((args as any)?.requests) ? (args as any).requests : [];
        const labels = requests.map((req: any, index: number) => `#${index + 1} @${String(req?.peerName ?? "?")}`).join(", ");
        let text = theme.fg("toolTitle", theme.bold("delegate_batch ")) + theme.fg("accent", labels || "none");
        if (!context.expanded) return new Text(text, 0, 0);

        for (const [index, req] of requests.entries()) {
          const task = String(req?.task ?? "").trim();
          const ctxText = String(req?.context ?? "").trim();
          const expected = String(req?.expectedOutput ?? "").trim();
          text += `\n\n${theme.fg("accent", `Request ${index + 1}`)}`;
          text += `\n${theme.fg("dim", `peer: @${String(req?.peerName ?? "?")}`)}`;
          if (task) text += `\n${theme.fg("text", task)}`;
          if (ctxText) text += `\n\n${theme.fg("dim", "Context")}` + `\n${theme.fg("text", ctxText)}`;
          if (expected) text += `\n\n${theme.fg("dim", "Expected Output")}` + `\n${theme.fg("text", expected)}`;
        }
        return new Text(text, 0, 0);
      },
      renderResult: (result, { expanded, isPartial }, theme) => {
        if (isPartial) return new Text(theme.fg("warning", "Launching batch..."), 0, 0);
        const launches = Array.isArray(result.details) ? (result.details as DelegationLaunch[]) : [];
        if (launches.length === 0) return new Text(theme.fg("error", "delegate_batch: missing launch details"), 0, 0);

        let text = theme.fg("success", `${launches.length} delegation${launches.length === 1 ? "" : "s"} launched`);
        for (const launch of launches) {
          text += `\n` + theme.fg("dim", `@${launch.peerName} job:${launch.jobId} session:${launch.sessionId}`);
        }

        if (expanded) {
          for (const launch of launches) {
            text += `\n\n${theme.fg("accent", launch.title)}`;
            text += `\n${theme.fg("text", launch.delegationMessage)}`;
          }
        }

        return new Text(text, 0, 0);
      },
      execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
        const parsed = delegateBatchRequestSchema.safeParse(params);
        if (!parsed.success) {
          throw new Error(`Invalid delegate_batch request: ${parsed.error.message}`);
        }

        const settled = await Promise.allSettled(parsed.data.requests.map((r) => delegateOnceBounded(r, ctx)));
        const launches = settled.map((s, i) => {
          if (s.status === "fulfilled") return s.value.launch;
          const peerName = parsed.data.requests[i]?.peerName ?? "researcher";
          const jobId = `error-${i + 1}`;
          return {
            title: reportTitle(peerName, jobId),
            peerName,
            jobId,
            sessionId: "(error)",
            sessionState: "new" as const,
            delegationMessage: `delegate_batch error while launching request ${i + 1}`,
            routing: undefined,
            launchedAt: new Date().toISOString(),
          } satisfies DelegationLaunch;
        });

        return {
          content: [{ type: "text", text: launches.map((launch) => formatLaunchMessage(launch)).join("\n\n---\n\n") || "ok" }],
          details: launches,
        };
      },
    }),
  );
}
