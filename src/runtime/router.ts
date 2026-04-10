import { SessionManager } from "@mariozechner/pi-coding-agent";
import type { Env } from "../env.js";
import type { GhostyConfig } from "../config/schema.js";
import { createGhostySession } from "../pi/createSession.js";
import { delegateRequestSchema, routingDecisionSchema, type DelegateRequest, type RoutingDecision } from "./contracts.js";
import type { JsonlTrace } from "../logging/jsonlTrace.js";
import type { CatalogEntry, PeerName, SessionCatalogStore } from "./sessionCatalogStore.js";

function safeJsonParse<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

function lastAssistantText(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== "assistant") continue;
    if (typeof m?.content === "string") return m.content;
    if (Array.isArray(m?.content)) {
      const text = m.content
        .filter((b: any) => b?.type === "text" && typeof b.text === "string")
        .map((b: any) => b.text)
        .join("");
      if (text.trim()) return text;
    }
  }
  return "";
}

export class Router {
  constructor(
    private readonly projectDir: string,
    private readonly workDir: string,
    private readonly runDir: string,
    private readonly env: Env,
    private readonly config: GhostyConfig,
    private readonly catalog: SessionCatalogStore,
    private readonly trace: JsonlTrace,
  ) {}

  private async askJson(prompt: string): Promise<string> {
    const { session } = await createGhostySession({
      projectDir: this.projectDir,
      workDir: this.workDir,
      runDir: this.runDir,
      env: { ...this.env, GHOSTY_DISABLE_MEMORY: true },
      config: this.config,
      agentName: "router",
      sessionManager: SessionManager.inMemory(this.workDir),
      customTools: [],
    });
    await session.prompt(prompt, { source: "extension" });
    return lastAssistantText(session.messages as any[]).trim();
  }

  private buildSemanticFallback(request: DelegateRequest, summaryBase: string): CatalogEntry["semantic"] {
    const task = request.task.trim().split("\n")[0] || "Task";
    return {
      title: task.slice(0, 80),
      summary: summaryBase || request.context.trim().slice(0, 240) || request.task.trim().slice(0, 240),
      tags: [request.peerName, "fallback"],
      updatedAt: new Date().toISOString(),
      source: "llm",
      confidence: "low",
    };
  }

  async ensureSemantic(entry: CatalogEntry, request: DelegateRequest, reportSummary?: string): Promise<CatalogEntry> {
    const cooldown = this.config.defaults.routing?.semantic?.updateCooldownMs ?? 300000;
    const now = Date.now();
    const last = Date.parse(entry.semantic?.updatedAt ?? "");
    const hasSemantic = !!entry.semantic?.title && !!entry.semantic?.summary && Array.isArray(entry.semantic?.tags);
    const stale = !Number.isFinite(last) || now - last > cooldown;
    if (hasSemantic && !stale) return entry;

    const started = Date.now();
    await this.trace.append({ type: "session_semantic_enrich_start", sessionId: entry.sessionId, peerName: entry.peerName });

    const prompt = [
      "Return strict JSON only.",
      "You are enriching a session catalog entry for routing.",
      "Output schema:",
      '{"title":"...","summary":"...","tags":["..."]}',
      "",
      `peerName: ${entry.peerName}`,
      `projectTag: ${this.config.defaults.projectTag}`,
      `cwd: ${entry.cwd}`,
      `task: ${request.task}`,
      `context: ${request.context || ""}`,
      `expectedOutput: ${request.expectedOutput || ""}`,
      `peerReportSummary: ${reportSummary || entry.semantic?.summary || ""}`,
    ].join("\n");

    let semantic = this.buildSemanticFallback(request, reportSummary || entry.semantic?.summary || "");
    let success = false;

    for (let i = 0; i < 2; i++) {
      const raw = await this.askJson(prompt);
      const parsed = safeJsonParse<{ title?: string; summary?: string; tags?: string[] }>(raw);
      if (parsed?.title && parsed?.summary && Array.isArray(parsed.tags)) {
        semantic = {
          title: String(parsed.title).trim(),
          summary: String(parsed.summary).trim(),
          tags: parsed.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 12),
          updatedAt: new Date().toISOString(),
          source: "llm",
          confidence: "normal",
        };
        success = true;
        break;
      }
    }

    const updated = {
      ...entry,
      semantic,
    };

    await this.catalog.upsert(entry.peerName, updated);
    await this.trace.append({
      type: "session_semantic_enrich_end",
      sessionId: entry.sessionId,
      peerName: entry.peerName,
      success,
      durationMs: Date.now() - started,
    });
    return updated;
  }

  async route(peerName: PeerName, request: DelegateRequest): Promise<RoutingDecision> {
    const normalized = delegateRequestSchema.parse(request);
    const candidatesRaw = this.catalog
      .list(peerName)
      .filter((e) => !e.status?.retired)
      .sort((a, b) => {
        const aBusy = 0;
        const bBusy = 0;
        if (aBusy !== bBusy) return aBusy - bBusy;
        const aCtx = a.stats?.contextPercent ?? 0;
        const bCtx = b.stats?.contextPercent ?? 0;
        if (aCtx !== bCtx) return aCtx - bCtx;
        const aComp = a.stats?.compactions ?? 0;
        const bComp = b.stats?.compactions ?? 0;
        if (aComp !== bComp) return aComp - bComp;
        return Date.parse(b.lastUsedAt) - Date.parse(a.lastUsedAt);
      })
      .slice(0, this.config.defaults.routing?.semantic?.maxCandidates ?? 12);

    const candidates: CatalogEntry[] = [];
    for (const c of candidatesRaw) {
      candidates.push(await this.ensureSemantic(c, normalized));
    }

    if (candidates.length === 0) {
      return { action: "new", reason: "no candidates", confidence: 1 };
    }

    const compactThreshold = this.config.defaults.routing?.compactThresholdPercent ?? 50;
    const prompt = [
      "Return strict JSON only.",
      "Choose best session routing action.",
      "JSON schema:",
      '{"action":"resume|new|compact_then_resume","sessionId":"optional","reason":"...","confidence":0.0}',
      "Rules:",
      "- Prefer resume if semantic/session fit task.",
      `- If contextPercent >= ${compactThreshold}, choose compact_then_resume for that session (or new).`,
      "- Use new if no candidate fits.",
      "",
      `request.peerName=${peerName}`,
      `request.task=${normalized.task}`,
      `request.context=${normalized.context || ""}`,
      `request.expectedOutput=${normalized.expectedOutput || ""}`,
      "",
      "candidates:",
      JSON.stringify(
        candidates.map((c) => ({
          sessionId: c.sessionId,
          createdAt: c.createdAt,
          lastUsedAt: c.lastUsedAt,
          cwd: c.cwd,
          stats: c.stats,
          semantic: c.semantic,
        })),
        null,
        2,
      ),
    ].join("\n");

    let decision: RoutingDecision | undefined;
    for (let i = 0; i < 2; i++) {
      const raw = await this.askJson(prompt);
      const parsed = safeJsonParse<unknown>(raw);
      const valid = routingDecisionSchema.safeParse(parsed);
      if (!valid.success) continue;
      const d = valid.data;
      if ((d.action === "resume" || d.action === "compact_then_resume") && !d.sessionId) continue;
      if (d.sessionId && !candidates.find((c) => c.sessionId === d.sessionId)) continue;
      decision = d;
      break;
    }

    const finalDecision: RoutingDecision = decision ?? {
      action: "new",
      reason: "invalid router output",
      confidence: 0,
    };

    const chosen = finalDecision.sessionId ? candidates.find((c) => c.sessionId === finalDecision.sessionId) : undefined;
    const forcedDecision: RoutingDecision =
      chosen && (chosen.stats?.contextPercent ?? 0) >= compactThreshold && finalDecision.action === "resume"
        ? { ...finalDecision, action: "compact_then_resume", reason: `${finalDecision.reason}; forced by threshold` }
        : finalDecision;

    await this.trace.append({
      type: "session_route_decision",
      peerName,
      action: forcedDecision.action,
      chosenSessionId: forcedDecision.sessionId,
      confidence: forcedDecision.confidence,
      reason: forcedDecision.reason,
    });

    return forcedDecision;
  }
}
