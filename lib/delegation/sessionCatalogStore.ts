import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { ghostyPeerNames } from "./contracts.js";

export type PeerName = (typeof ghostyPeerNames)[number];

export interface CatalogEntry {
  peerName: PeerName;
  sessionId: string;
  sessionFile: string;
  createdAt: string;
  lastUsedAt: string;
  cwd: string;

  // Deterministic display name stored in the session file via session_info.
  // This mirrors SessionManager.getSessionName() when available.
  sessionName?: string;
  stats?: {
    messageCount?: number;
    toolCalls?: number;
    contextPercent?: number | null;
    compactions?: number;
  };
  health?: {
    toolSpamSignals?: number;
    loopSignals?: number;
  };
  status?: {
    retired?: boolean;
    retireReason?: string;
  };
  // Last selected model for the session (best-effort; used for routing constraints).
  model?: {
    provider: string;
    id: string;
  };

  semantic: {
    title: string;
    summary: string;
    tags: string[];
    updatedAt: string;
    source: "llm";
    confidence?: "normal" | "low";

    // Snapshot used for delta-based semantic refresh decisions.
    basis?: {
      messageCount?: number;
      toolCalls?: number;
      compactions?: number;
      lastUsedAt?: string;
    };

    // Advisory-only in v1; bounded LLM-owned drift metadata.
    weather?: {
      state: "good" | "drifting" | "stale";
      driftScore: number; // 0..1
      reason: string;
      updatedAt: string;
      authority: {
        level: "advisory";
      };
    };
  };
}

export interface SessionCatalog {
  version: 1;
  projectTag: string;
  peers: Record<PeerName, CatalogEntry[]>;
}

function emptyCatalog(projectTag: string): SessionCatalog {
  return {
    version: 1,
    projectTag,
    peers: {
      coder: [],
      researcher: [],
      reviewer: [],
      memory: [],
    },
  };
}

export class SessionCatalogStore {
  readonly path: string;
  private catalog: SessionCatalog;

  // Serialize writes to prevent lost updates and tmp rename races under delegate_batch concurrency.
  private saveChain: Promise<void> = Promise.resolve();

  constructor(private readonly runDir: string, private readonly projectTag: string) {
    this.path = resolve(runDir, "data", "session-catalog.json");
    this.catalog = emptyCatalog(projectTag);
  }

  async load(): Promise<SessionCatalog> {
    try {
      const raw = await readFile(this.path, "utf-8");
      const parsed = JSON.parse(raw) as SessionCatalog;
      if (parsed?.version !== 1 || !parsed?.peers) throw new Error("invalid catalog");
      this.catalog = parsed;
    } catch {
      this.catalog = emptyCatalog(this.projectTag);
      await this.save();
    }
    return this.catalog;
  }

  get(): SessionCatalog {
    return this.catalog;
  }

  list(peerName: PeerName): CatalogEntry[] {
    return [...(this.catalog.peers[peerName] ?? [])];
  }

  getEntry(peerName: PeerName, sessionId: string): CatalogEntry | undefined {
    return this.catalog.peers[peerName]?.find((e) => e.sessionId === sessionId);
  }

  async upsert(peerName: PeerName, entry: CatalogEntry): Promise<void> {
    const items = this.catalog.peers[peerName] ?? [];
    const idx = items.findIndex((e) => e.sessionId === entry.sessionId);
    if (idx >= 0) items[idx] = entry;
    else items.push(entry);
    this.catalog.peers[peerName] = items;
    await this.save();
  }

  async patch(peerName: PeerName, sessionId: string, patch: Partial<CatalogEntry>): Promise<CatalogEntry | undefined> {
    const entry = this.getEntry(peerName, sessionId);
    if (!entry) return undefined;
    const merged: CatalogEntry = {
      ...entry,
      ...patch,
      stats: { ...(entry.stats ?? {}), ...(patch.stats ?? {}) },
      health: { ...(entry.health ?? {}), ...(patch.health ?? {}) },
      status: { ...(entry.status ?? {}), ...(patch.status ?? {}) },
      semantic: {
        ...(entry.semantic ?? {}),
        ...(patch.semantic ?? {}),
        basis: { ...(entry.semantic?.basis ?? {}), ...(patch.semantic?.basis ?? {}) },
        weather: { ...(entry.semantic?.weather ?? {}), ...(patch.semantic?.weather ?? {}) } as any,
      } as CatalogEntry["semantic"],
    };
    await this.upsert(peerName, merged);
    return merged;
  }

  async save(): Promise<void> {
    // Chain saves so concurrent calls can't clobber each other.
    // Ensure the chain continues even if a prior save failed.
    this.saveChain = this.saveChain.then(
      () => this.saveOnce(),
      () => this.saveOnce(),
    );
    return this.saveChain;
  }

  private async saveOnce(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${randomUUID()}.tmp`;
    await writeFile(tmp, `${JSON.stringify(this.catalog, null, 2)}\n`, "utf-8");
    await rename(tmp, this.path);
  }

  countByPeer(): Record<PeerName, number> {
    const out = {} as Record<PeerName, number>;
    for (const peer of ghostyPeerNames) out[peer] = this.catalog.peers[peer]?.length ?? 0;
    return out;
  }
}
