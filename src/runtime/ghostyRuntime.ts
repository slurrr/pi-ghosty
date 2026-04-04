import type { AgentSession } from "@mariozechner/pi-coding-agent";
import type { Env } from "../env.js";
import type { GhostyConfig } from "../config/schema.js";
import { createGhostySession } from "../pi/createSession.js";
import { ArtifactStore } from "../artifacts/store.js";
import { JsonlTrace } from "../logging/jsonlTrace.js";
import {
  buildPeerDelegationPrompt,
  delegateRequestSchema,
  peerOutputSchema,
  type DelegateRequest,
  type PeerOutput,
  type PeerResult,
  ghostyPeerNames,
} from "./contracts.js";
import { createDelegateTool } from "./delegateTool.js";
import { createPeerReportTool } from "./peerReportTool.js";

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
  rootDir: string;
  runDir: string;
  env: Env;
  config: GhostyConfig;
}

interface SessionHandle {
  session: AgentSession;
  sessionId: string;
  sessionState: "new" | "resumed";
}

export class GhostyRuntime {
  private readonly peers = new Map<(typeof ghostyPeerNames)[number], SessionHandle>();

  private constructor(
    private readonly rootDir: string,
    private readonly runDir: string,
    private readonly env: Env,
    private readonly config: GhostyConfig,
    private readonly coordinator: SessionHandle,
    private readonly trace: JsonlTrace,
    private readonly artifacts: ArtifactStore,
  ) {}

  static async create(options: GhostyRuntimeOptions): Promise<GhostyRuntime> {
    const { rootDir, runDir, env, config } = options;
    let delegateHandler = async (_request: DelegateRequest): Promise<PeerResult> => {
      throw new Error("Delegate handler is not ready");
    };
    const delegateTool = createDelegateTool((request) => delegateHandler(request));

    const { session: coordinatorSession, sessionManager } = await createGhostySession({
      rootDir,
      runDir,
      env,
      config,
      agentName: "coordinator",
      customTools: [delegateTool],
    });

    const coordinator = {
      session: coordinatorSession,
      sessionId: sessionManager.getSessionId(),
      sessionState: sessionManager.getEntries().length > 0 ? "resumed" : "new",
    } as SessionHandle;

    const trace = JsonlTrace.forRuntime(runDir, coordinator.sessionId);
    const artifacts = ArtifactStore.forProject(runDir, config.defaults.projectTag);

    const runtime = new GhostyRuntime(rootDir, runDir, env, config, coordinator, trace, artifacts);

    delegateHandler = runtime.delegateToPeer.bind(runtime);
    return runtime;
  }

  getCoordinatorSession(): AgentSession {
    return this.coordinator.session;
  }

  async handleCoordinatorMessage(text: string): Promise<string> {
    await this.trace.append({
      type: "user_message",
      source: "coordinator",
      text,
    });
    await this.coordinator.session.prompt(text, { source: "extension" });
    const reply = lastAssistantText(this.coordinator.session);
    await this.trace.append({
      type: "coordinator_reply",
      text: reply,
    });
    return reply;
  }

  async getPeerSession(peerName: (typeof ghostyPeerNames)[number]): Promise<SessionHandle> {
    const existing = this.peers.get(peerName);
    if (existing) return existing;

    const { session, sessionManager } = await createGhostySession({
      rootDir: this.rootDir,
      runDir: this.runDir,
      env: this.env,
      config: this.config,
      agentName: peerName,
      customTools: [createPeerReportTool()],
    });

    const handle = {
      session,
      sessionId: sessionManager.getSessionId(),
      sessionState: sessionManager.getEntries().length > 0 ? "resumed" : "new",
    } as SessionHandle;
    this.peers.set(peerName, handle);
    return handle;
  }

  async delegateToPeer(request: DelegateRequest): Promise<PeerResult> {
    const normalized = delegateRequestSchema.parse(request);
    const peer = await this.getPeerSession(request.peerName);

    await this.trace.append({
      type: "delegate_start",
      peerName: normalized.peerName,
      peerSessionId: peer.sessionId,
      peerSessionState: peer.sessionState,
      taskLen: normalized.task.length,
    });

    const prompt = buildPeerDelegationPrompt(normalized, {
      projectTag: this.config.defaults.projectTag,
      coordinatorSessionId: this.coordinator.sessionId,
      peerSessionId: peer.sessionId,
      sessionState: peer.sessionState,
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
      if (parsed.success) {
        reportOutput = parsed.data;
      }
      break;
    }

    let output: PeerOutput;
    let reportSource: "tool" | "text";
    let rawText: string | undefined;

    if (reportOutput) {
      output = reportOutput;
      reportSource = "tool";
    } else {
      rawText = lastAssistantText(peer.session);
      output = peerOutputSchema.parse({ summary: rawText?.trim() ? rawText.trim() : "(no peer report)" });
      reportSource = "text";
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

    await this.trace.append({
      type: "delegate_end",
      peerName: normalized.peerName,
      peerSessionId: peer.sessionId,
      peerSessionState: peer.sessionState,
      reportSource,
    });

    return {
      peerName: normalized.peerName,
      sessionId: peer.sessionId,
      sessionState: peer.sessionState,
      output,
      reportSource,
      rawText,
    };
  }
}
