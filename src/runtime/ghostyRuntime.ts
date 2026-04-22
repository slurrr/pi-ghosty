import { resolve } from "node:path";
import { SessionManager, type AgentSession, type AgentSessionServices } from "@mariozechner/pi-coding-agent";
import type { Env } from "../env.js";
import type { GhostyConfig } from "../config/schema.js";
import { createGhostySession } from "../pi/createSession.js";
import { ArtifactStore } from "../artifacts/store.js";
import { JsonlTrace, legacyTraceMetadata } from "../logging/jsonlTrace.js";
import {
  buildPeerDelegationPrompt,
  delegateBatchRequestSchema,
  delegateRequestSchema,
  peerOutputSchema,
  type DelegateBatchRequest,
  type DelegateRequest,
  type PeerOutput,
  type PeerResult,
  ghostyPeerNames,
} from "./contracts.js";
import { createDelegateTool } from "./delegateTool.js";
import { createDelegateBatchTool } from "./delegateBatchTool.js";
import { KeyedMutex, Semaphore } from "./concurrency.js";
import { SessionCatalogStore, type CatalogEntry, type PeerName } from "./sessionCatalogStore.js";
import { SessionPool } from "./sessionPool.js";
import { Router } from "./router.js";
import { formatSessionName } from "./sessionNaming.js";
import { WorkflowMonitor } from "./workflowMonitor.js";

function lastAssistantText(session: AgentSession): string {
  const messages = session.messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message: any = messages[i];
    if (message.role !== "assistant") continue;
    const content = message.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      const text = content
        .filter((block: any) => block.type === "text" && typeof block.text === "string")
        .map((block: any) => block.text)
        .join("");
      if (text.trim()) return text;
    }
  }
  return "(no assistant text)";
}

export interface GhostyRuntimeOptions {
  projectDir: string;
  workDir: string;
  runDir: string;
  env: Env;
  config: GhostyConfig;

  coordinatorSessionManager?: import("@mariozechner/pi-coding-agent").SessionManager;
  coordinatorSessionStartEvent?: import("@mariozechner/pi-coding-agent").SessionStartEvent;
}

interface SessionHandle {
  session: AgentSession;
  sessionManager?: SessionManager;
  sessionId: string;
  sessionState: "new" | "resumed";
  services?: AgentSessionServices;
  extensionsResult?: any;
  modelFallbackMessage?: string;
}

export class GhostyRuntime {
  private readonly semaphore: Semaphore;
  private readonly sessionMutex = new KeyedMutex();
  private readonly busySessionIds = new Set<string>();
  private readonly pool: SessionPool;
  private readonly catalogStore: SessionCatalogStore;
  private readonly router: Router;
  private readonly workflowMonitor: WorkflowMonitor;

  private constructor(
    private readonly projectDir: string,
    private readonly workDir: string,
    private readonly runDir: string,
    private readonly env: Env,
    private readonly config: GhostyConfig,
    private readonly coordinator: SessionHandle,
    private readonly trace: JsonlTrace,
    private readonly artifacts: ArtifactStore,
  ) {
    const routing = this.config.routing.defaults;
    this.semaphore = new Semaphore(routing.maxParallelDelegations);
    this.pool = new SessionPool(this.projectDir, this.workDir, this.runDir, this.env, this.config);
    this.catalogStore = new SessionCatalogStore(this.runDir, this.config.defaults.projectTag);
    this.router = new Router(this.projectDir, this.workDir, this.runDir, this.env, this.config, this.catalogStore, this.trace);
    this.workflowMonitor = new WorkflowMonitor(this.runDir, this.config.defaults.workflowMonitor);
  }

  static async create(options: GhostyRuntimeOptions): Promise<GhostyRuntime> {
    const { projectDir, workDir, runDir, env, config, coordinatorSessionManager, coordinatorSessionStartEvent } = options;
    let delegateHandler = async (_request: DelegateRequest): Promise<PeerResult> => {
      throw new Error("Delegate handler is not ready");
    };
    let delegateBatchHandler = async (_request: DelegateBatchRequest): Promise<PeerResult[]> => {
      throw new Error("Delegate batch handler is not ready");
    };

    const delegateTool = createDelegateTool((request) => delegateHandler(request));
    const delegateBatchTool = createDelegateBatchTool((request) => delegateBatchHandler(request));

    const {
      session: coordinatorSession,
      sessionManager,
      services,
      extensionsResult,
      modelFallbackMessage,
    } = await createGhostySession({
      projectDir,
      workDir,
      runDir,
      env,
      config,
      agentName: "coordinator",
      customTools: [delegateTool, delegateBatchTool],
      sessionManager: coordinatorSessionManager,
      sessionStartEvent: coordinatorSessionStartEvent,
    });

    const coordinator = {
      session: coordinatorSession,
      sessionManager,
      sessionId: sessionManager.getSessionId(),
      sessionState: sessionManager.getEntries().length > 0 ? "resumed" : "new",
      services,
      extensionsResult,
      modelFallbackMessage,
    } as SessionHandle;

    const trace = JsonlTrace.forRuntime(runDir, coordinator.sessionId, {
      defaultMetadata: legacyTraceMetadata({ traceScope: "runtime" }),
    });
    const artifacts = ArtifactStore.forProject(runDir, config.defaults.projectTag);

    const runtime = new GhostyRuntime(projectDir, workDir, runDir, env, config, coordinator, trace, artifacts);
    const catalog = await runtime.catalogStore.load();
    await trace.append({ type: "session_catalog_loaded", version: catalog.version, counts: runtime.catalogStore.countByPeer() });
    try {
      void runtime.workflowMonitor.run("session_start");
    } catch {
      // best-effort only
    }

    delegateHandler = runtime.delegateToPeer.bind(runtime);
    delegateBatchHandler = runtime.delegateBatch.bind(runtime);
    return runtime;
  }

  getCoordinatorSession(): AgentSession {
    return this.coordinator.session;
  }

  getCoordinatorHandle(): { session: AgentSession; sessionId: string; sessionState: "new" | "resumed" } {
    return {
      session: this.coordinator.session,
      sessionId: this.coordinator.sessionId,
      sessionState: this.coordinator.sessionState,
    };
  }

  getCoordinatorServices(): AgentSessionServices {
    if (!this.coordinator.services) {
      throw new Error("Coordinator services not available");
    }
    return this.coordinator.services;
  }

  getCoordinatorModelFallbackMessage(): string | undefined {
    return this.coordinator.modelFallbackMessage;
  }

  getCoordinatorExtensionsResult(): any {
    if (!this.coordinator.extensionsResult) {
      throw new Error("Coordinator extensionsResult not available");
    }
    return this.coordinator.extensionsResult;
  }

  async handleCoordinatorMessage(
    text: string,
    options?: { streamingBehavior?: "steer" | "followUp" },
  ): Promise<string> {
    try {
      void this.workflowMonitor.maybeRun("heartbeat_user_message");
    } catch {
      // best-effort only
    }

    await this.trace.append({
      type: "user_message",
      source: "coordinator",
      text,
    });
    await this.coordinator.session.prompt(text, { source: "extension", streamingBehavior: options?.streamingBehavior });
    const reply = lastAssistantText(this.coordinator.session);
    await this.trace.append({
      type: "coordinator_reply",
      text: reply,
    });
    return reply;
  }

  private peerSessionDir(peerName: PeerName): string {
    return resolve(this.runDir, "data", "sessions", peerName);
  }

  private async syncPeerCatalog(peerName: PeerName): Promise<void> {
    const infos = await SessionManager.list(this.workDir, this.peerSessionDir(peerName));
    for (const info of infos) {
      const existing = this.catalogStore.getEntry(peerName, info.id);
      if (existing) continue;

      const manager = SessionManager.open(info.path, this.peerSessionDir(peerName));
      const header = manager.getHeader();
      const compactions = manager.getEntries().filter((e: any) => e.type === "compaction").length;
      const entry: CatalogEntry = {
        peerName,
        sessionId: info.id,
        sessionFile: info.path,
        createdAt: info.created.toISOString(),
        lastUsedAt: info.modified.toISOString(),
        cwd: header?.cwd ?? this.workDir,
        sessionName: manager.getSessionName() ?? undefined,
        stats: {
          messageCount: info.messageCount,
          contextPercent: null,
          compactions,
        },
        semantic: {
          title: (info.firstMessage || `${peerName} session`).slice(0, 80),
          summary: info.firstMessage || "Imported session",
          tags: [peerName, "imported"],
          updatedAt: new Date(0).toISOString(),
          source: "llm",
          confidence: "low",
          basis: {
            messageCount: info.messageCount,
            toolCalls: undefined,
            compactions,
            lastUsedAt: info.modified.toISOString(),
          },
        },
      };
      await this.catalogStore.upsert(peerName, entry);
      await this.trace.append({ type: "session_catalog_updated", sessionId: entry.sessionId, fields: ["create_import"] });
    }
  }

  private async ensureCatalogEntryForHandle(peerName: PeerName, sessionId: string, sessionFile: string, request: DelegateRequest): Promise<CatalogEntry> {
    const existing = this.catalogStore.getEntry(peerName, sessionId);
    if (existing) {
      return this.router.ensureSemantic(existing, request);
    }

    const now = new Date().toISOString();
    const manager = SessionManager.open(sessionFile, this.peerSessionDir(peerName));
    const header = manager.getHeader();
    const messageCount = manager.getEntries().filter((e: any) => e.type === "message").length;
    const compactions = manager.getEntries().filter((e: any) => e.type === "compaction").length;

    const entry: CatalogEntry = {
      peerName,
      sessionId,
      sessionFile,
      createdAt: now,
      lastUsedAt: now,
      cwd: header?.cwd ?? this.workDir,
      stats: {
        messageCount,
        contextPercent: null,
        compactions,
      },
      semantic: {
        title: request.task.trim().slice(0, 80) || `${peerName} session`,
        summary: request.context.trim() || request.task.trim(),
        tags: [peerName, "new"],
        updatedAt: new Date(0).toISOString(),
        source: "llm",
        confidence: "low",
        basis: {
          messageCount,
          toolCalls: undefined,
          compactions,
          lastUsedAt: now,
        },
      },
    };
    await this.catalogStore.upsert(peerName, entry);
    await this.trace.append({ type: "session_catalog_updated", sessionId, fields: ["create"] });
    return this.router.ensureSemantic(entry, request);
  }

  private async resolvePeerSession(request: DelegateRequest): Promise<{
    handle: Awaited<ReturnType<SessionPool["createNew"]>>;
    routing: { action: "resume" | "new" | "compact_then_resume"; reason?: string; confidence?: number };
  }> {
    const peerName = request.peerName;
    await this.syncPeerCatalog(peerName);
    const decision = await this.router.route(peerName, request);

    if (decision.action === "new" || !decision.sessionId) {
      const handle = await this.pool.createNew(peerName);
      const sessionFile = handle.sessionManager.getSessionFile();
      if (!sessionFile) throw new Error("New peer session has no backing file");
      await this.ensureCatalogEntryForHandle(peerName, handle.sessionId, sessionFile, request);
      return { handle, routing: { action: "new", reason: decision.reason, confidence: decision.confidence } };
    }

    const catalogEntry = this.catalogStore.getEntry(peerName, decision.sessionId);
    if (!catalogEntry?.sessionFile) {
      const handle = await this.pool.createNew(peerName);
      const sessionFile = handle.sessionManager.getSessionFile();
      if (!sessionFile) throw new Error("New peer session has no backing file");
      await this.ensureCatalogEntryForHandle(peerName, handle.sessionId, sessionFile, request);
      return { handle, routing: { action: "new", reason: "missing session file", confidence: 0 } };
    }

    const handle = await this.pool.loadExisting(peerName, catalogEntry.sessionFile);
    await this.ensureCatalogEntryForHandle(peerName, handle.sessionId, catalogEntry.sessionFile, request);

    return {
      handle,
      routing: {
        action: decision.action,
        reason: decision.reason,
        confidence: decision.confidence,
      },
    };
  }

  private async executeDelegation(request: DelegateRequest): Promise<PeerResult> {
    const normalized = delegateRequestSchema.parse(request);
    const { handle: peer, routing } = await this.resolvePeerSession(normalized);

    const sessionFile = peer.sessionManager.getSessionFile();
    if (!sessionFile) {
      throw new Error(`Peer session ${peer.sessionId} is not persisted`);
    }

    return this.sessionMutex.runExclusive(peer.sessionId, async () => {
      this.busySessionIds.add(peer.sessionId);
      this.pool.touch(peer.sessionId);

      try {
        await this.trace.append({
          type: "delegate_start",
          peerName: normalized.peerName,
          peerSessionId: peer.sessionId,
          peerSessionState: peer.sessionState,
          taskLen: normalized.task.length,
        });

      if (routing.action === "compact_then_resume") {
        try {
          await peer.session.compact("Compact for continued delegation in pi-ghosty.");
        } catch {
          // If compaction fails we continue and let the model/runtime decide naturally.
        }
      }

      const prompt = buildPeerDelegationPrompt(normalized, {
        projectTag: this.config.defaults.projectTag,
        coordinatorSessionId: this.coordinator.sessionId,
        peerSessionId: peer.sessionId,
        sessionState: peer.sessionState,
        jobId: `${this.coordinator.sessionId}:${peer.sessionId}`,
      });

      const beforeCount = peer.session.messages.length;
      await peer.session.prompt(prompt, { source: "extension" });
      const newMessages = peer.session.messages.slice(beforeCount);
      let reportOutput: PeerOutput | undefined;
      for (let i = newMessages.length - 1; i >= 0; i--) {
        const m: any = newMessages[i];
        if (m?.role !== "toolResult") continue;
        if (m?.toolName !== "peer_report") continue;
        const parsed = peerOutputSchema.safeParse(m.details);
        if (parsed.success) reportOutput = parsed.data;
        break;
      }

      let output: PeerOutput;
      let reportSource: "tool" | "text";
      let rawText: string | undefined;

      if (reportOutput) {
        output = reportOutput;
        reportSource = "tool";
      } else {
        await this.trace.append({
          type: "peer_report_missing",
          peerName: normalized.peerName,
          peerSessionId: peer.sessionId,
        });

        const retryBefore = peer.session.messages.length;
        await peer.session.prompt('Call the "peer_report" tool now with your result. Do not write additional text.', {
          source: "extension",
        });
        const retryNewMessages = peer.session.messages.slice(retryBefore);
        for (let i = retryNewMessages.length - 1; i >= 0; i--) {
          const m: any = retryNewMessages[i];
          if (m?.role !== "toolResult") continue;
          if (m?.toolName !== "peer_report") continue;
          const parsed = peerOutputSchema.safeParse(m.details);
          if (parsed.success) reportOutput = parsed.data;
          break;
        }

        if (reportOutput) {
          output = reportOutput;
          reportSource = "tool";
        } else {
          rawText = lastAssistantText(peer.session);
          output = peerOutputSchema.parse({ summary: rawText?.trim() || "(no peer report)" });
          reportSource = "text";
        }
      }

      if (Array.isArray(output.artifacts)) {
        for (const text of output.artifacts) {
          await this.artifacts.append({
            projectTag: this.config.defaults.projectTag,
            peerName: normalized.peerName,
            kind: "peer_artifact",
            text,
          });
        }
      }

      const stats = peer.session.getSessionStats();
      const contextUsage: any = peer.session.getContextUsage();
      const compactions = peer.session.sessionManager.getEntries().filter((e: any) => e.type === "compaction").length;
      const nowIso = new Date().toISOString();

      const updated = await this.catalogStore.patch(normalized.peerName, peer.sessionId, {
        sessionFile,
        lastUsedAt: nowIso,
        sessionName: peer.sessionManager.getSessionName() ?? undefined,
        stats: {
          messageCount: stats.totalMessages,
          toolCalls: stats.toolCalls,
          contextPercent: typeof contextUsage?.percent === "number" ? contextUsage.percent : null,
          compactions,
        },
      });

      const retireAfter = this.config.routing.defaults.retireAfterCompactions;
      if (updated && (updated.stats?.compactions ?? 0) >= retireAfter) {
        await this.catalogStore.patch(normalized.peerName, peer.sessionId, {
          status: { retired: true, retireReason: `compactions>=${retireAfter}` },
        });
      }

      // Semantic enrichment + session naming MUST be best-effort.
      // Delegation/tool results are higher precedence than routing/semantic metadata.
      const catalogEntry = this.catalogStore.getEntry(normalized.peerName, peer.sessionId);
      if (catalogEntry) {
        try {
          const enriched = await this.router.ensureSemantic(catalogEntry, normalized, output.summary);
          const desiredName = formatSessionName(normalized.peerName, enriched.semantic.title);
          const currentName = peer.sessionManager.getSessionName();
          if (desiredName && desiredName !== currentName) {
            peer.sessionManager.appendSessionInfo(desiredName);
            await this.trace.append({
              type: "session_name_updated",
              peerName: normalized.peerName,
              sessionId: peer.sessionId,
              oldName: currentName,
              newName: desiredName,
            });

            // Mirror into catalog deterministically.
            await this.catalogStore.patch(normalized.peerName, peer.sessionId, {
              sessionName: desiredName,
            });
          }
        } catch (err: any) {
          await this.trace.append({
            type: "delegate_semantic_error",
            peerName: normalized.peerName,
            peerSessionId: peer.sessionId,
            error: err?.message ?? String(err),
          });
        }
      }

      await this.trace.append({
        type: "session_catalog_updated",
        sessionId: peer.sessionId,
        fields: ["lastUsedAt", "stats", "semantic"],
      });

      await this.trace.append({
        type: "delegate_end",
        peerName: normalized.peerName,
        peerSessionId: peer.sessionId,
        peerSessionState: peer.sessionState,
        reportSource,
      });

      this.pool.enforceCaps({
        maxTotal: this.config.routing.defaults.maxLoadedSessionsTotal,
        maxPerPeer: this.config.routing.defaults.maxLoadedSessionsPerPeer,
        busySessionIds: this.busySessionIds,
      });

        return {
          peerName: normalized.peerName,
          sessionId: peer.sessionId,
          sessionState: peer.sessionState,
          output,
          reportSource,
          rawText,
          routing,
        };
      } finally {
        this.busySessionIds.delete(peer.sessionId);
      }
    });
  }

  async delegateToPeer(request: DelegateRequest): Promise<PeerResult> {
    return this.semaphore.withPermit(async () => this.executeDelegation(request));
  }

  async delegateBatch(request: DelegateBatchRequest): Promise<PeerResult[]> {
    const normalized = delegateBatchRequestSchema.parse(request);
    const started = Date.now();
    await this.trace.append({
      type: "delegate_batch_start",
      requestCount: normalized.requests.length,
      parallelism: this.config.routing.defaults.maxParallelDelegations,
    });

    const results = await Promise.all(normalized.requests.map((r) => this.delegateToPeer(r)));

    await this.trace.append({
      type: "delegate_batch_end",
      requestCount: normalized.requests.length,
      durationMs: Date.now() - started,
      parallelism: this.config.routing.defaults.maxParallelDelegations,
      sessionLocks: this.sessionMutex.keys().length,
    });
    return results;
  }
}
