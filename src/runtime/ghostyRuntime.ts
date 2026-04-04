import type { AgentSession } from "@mariozechner/pi-coding-agent";
import type { Env } from "../env.js";
import type { GhostyConfig } from "../config/schema.js";
import { createGhostySession } from "../pi/createSession.js";
import { buildPeerDelegationPrompt, delegateRequestSchema, type DelegateRequest, type PeerResult, ghostyPeerNames } from "./contracts.js";
import { createDelegateTool } from "./delegateTool.js";

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
    private readonly env: Env,
    private readonly config: GhostyConfig,
    private readonly coordinator: SessionHandle,
  ) {}

  static async create(options: GhostyRuntimeOptions): Promise<GhostyRuntime> {
    const { rootDir, env, config } = options;
    let delegateHandler = async (_request: DelegateRequest): Promise<PeerResult> => {
      throw new Error("Delegate handler is not ready");
    };
    const delegateTool = createDelegateTool((request) => delegateHandler(request));

    const { session: coordinatorSession, sessionManager } = await createGhostySession({
      rootDir,
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

    const runtime = new GhostyRuntime(rootDir, env, config, coordinator);

    delegateHandler = runtime.delegateToPeer.bind(runtime);
    return runtime;
  }

  getCoordinatorSession(): AgentSession {
    return this.coordinator.session;
  }

  async handleCoordinatorMessage(text: string): Promise<string> {
    await this.coordinator.session.prompt(text, { source: "extension" });
    return lastAssistantText(this.coordinator.session);
  }

  async getPeerSession(peerName: (typeof ghostyPeerNames)[number]): Promise<SessionHandle> {
    const existing = this.peers.get(peerName);
    if (existing) return existing;

    const { session, sessionManager } = await createGhostySession({
      rootDir: this.rootDir,
      env: this.env,
      config: this.config,
      agentName: peerName,
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
    const peer = await this.getPeerSession(request.peerName);
    const prompt = buildPeerDelegationPrompt(request, {
      projectTag: this.config.defaults.projectTag,
      coordinatorSessionId: this.coordinator.sessionId,
      peerSessionId: peer.sessionId,
      sessionState: peer.sessionState,
    });

    await peer.session.prompt(prompt, { source: "extension" });
    return {
      peerName: request.peerName,
      sessionId: peer.sessionId,
      sessionState: peer.sessionState,
      summary: lastAssistantText(peer.session),
    };
  }
}
