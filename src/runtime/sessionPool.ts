import { resolve } from "node:path";
import { SessionManager, type AgentSession, type AgentSessionServices } from "@mariozechner/pi-coding-agent";
import type { Env } from "../env.js";
import type { GhostyConfig } from "../config/schema.js";
import { createGhostySession } from "../pi/createSession.js";
import { createPeerReportTool } from "./peerReportTool.js";
import type { PeerName } from "./sessionCatalogStore.js";

export interface LoadedSessionHandle {
  peerName: PeerName;
  session: AgentSession;
  sessionManager: SessionManager;
  sessionId: string;
  sessionFile?: string;
  sessionState: "new" | "resumed";
  services?: AgentSessionServices;
  lastTouchedAt: number;
}

export class SessionPool {
  private readonly handles = new Map<string, LoadedSessionHandle>();

  constructor(
    private readonly projectDir: string,
    private readonly workDir: string,
    private readonly runDir: string,
    private readonly env: Env,
    private readonly config: GhostyConfig,
  ) {}

  private peerSessionDir(peerName: PeerName): string {
    return resolve(this.runDir, "data", "sessions", peerName);
  }

  private async loadWithManager(peerName: PeerName, sessionManager: SessionManager): Promise<LoadedSessionHandle> {
    const { session, services } = await createGhostySession({
      projectDir: this.projectDir,
      workDir: this.workDir,
      runDir: this.runDir,
      env: this.env,
      config: this.config,
      agentName: peerName,
      customTools: [createPeerReportTool()],
      sessionManager,
    });
    const handle: LoadedSessionHandle = {
      peerName,
      session,
      sessionManager,
      sessionId: sessionManager.getSessionId(),
      sessionFile: sessionManager.getSessionFile(),
      sessionState: sessionManager.getEntries().length > 0 ? "resumed" : "new",
      services,
      lastTouchedAt: Date.now(),
    };
    this.handles.set(handle.sessionId, handle);
    return handle;
  }

  async loadExisting(peerName: PeerName, sessionFile: string): Promise<LoadedSessionHandle> {
    const existing = [...this.handles.values()].find((h) => h.sessionFile === sessionFile);
    if (existing) {
      existing.lastTouchedAt = Date.now();
      return existing;
    }
    const manager = SessionManager.open(sessionFile, this.peerSessionDir(peerName));
    return this.loadWithManager(peerName, manager);
  }

  async createNew(peerName: PeerName): Promise<LoadedSessionHandle> {
    const manager = SessionManager.create(this.workDir, this.peerSessionDir(peerName));
    return this.loadWithManager(peerName, manager);
  }

  touch(sessionId: string): void {
    const handle = this.handles.get(sessionId);
    if (handle) handle.lastTouchedAt = Date.now();
  }

  all(): LoadedSessionHandle[] {
    return [...this.handles.values()];
  }

  byPeer(peerName: PeerName): LoadedSessionHandle[] {
    return [...this.handles.values()].filter((h) => h.peerName === peerName);
  }

  unload(sessionId: string): void {
    const handle = this.handles.get(sessionId);
    if (!handle) return;
    handle.session.dispose();
    this.handles.delete(sessionId);
  }

  enforceCaps(options: {
    maxTotal: number;
    maxPerPeer: number;
    busySessionIds: Set<string>;
  }): void {
    const { maxTotal, maxPerPeer, busySessionIds } = options;

    const evictable = (h: LoadedSessionHandle) => !busySessionIds.has(h.sessionId);

    for (const peer of ["coder", "researcher", "reviewer", "memory"] as const) {
      const items = this.byPeer(peer).sort((a, b) => a.lastTouchedAt - b.lastTouchedAt);
      let over = Math.max(0, items.length - maxPerPeer);
      for (const h of items) {
        if (over <= 0) break;
        if (!evictable(h)) continue;
        this.unload(h.sessionId);
        over -= 1;
      }
    }

    const all = this.all().sort((a, b) => a.lastTouchedAt - b.lastTouchedAt);
    let overTotal = Math.max(0, all.length - maxTotal);
    for (const h of all) {
      if (overTotal <= 0) break;
      if (!evictable(h)) continue;
      this.unload(h.sessionId);
      overTotal -= 1;
    }
  }
}
