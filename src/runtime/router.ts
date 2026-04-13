import type { Model } from "@mariozechner/pi-ai";
import { completeSimple } from "@mariozechner/pi-ai";
import type { Env } from "../env.js";
import type { GhostyConfig } from "../config/schema.js";
import { delegateRequestSchema, routingDecisionSchema, type DelegateRequest, type RoutingDecision } from "./contracts.js";
import type { JsonlTrace } from "../logging/jsonlTrace.js";
import type { CatalogEntry, PeerName, SessionCatalogStore } from "./sessionCatalogStore.js";

function extractJsonObject(text: string): string | undefined {
  const trimmed = text.trim();

  // Strip ```json ... ``` fences if present.
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

  private async buildRouterModel(): Promise<Model<"openai-completions">> {
    const baseUrl = this.env.VLLM_BASE_URL || this.config.defaults.vllmBaseUrl;
    const { discoverVllmDefaultModel } = await import("../pi/vllmModelDiscovery.js");
    const vllmModel = await discoverVllmDefaultModel(baseUrl);

    return {
      id: vllmModel.id,
      name: "router (vLLM)",
      api: "openai-completions",
      provider: "vllm",
      baseUrl,
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: this.config.defaults.model.contextWindow,
      maxTokens: this.config.defaults.model.maxTokens,
      compat: {
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
      },
    };
  }

  private routerModelPromise: Promise<Model<"openai-completions">> | null = null;

  private async getRouterModel(): Promise<Model<"openai-completions">> {
    if (!this.routerModelPromise) this.routerModelPromise = this.buildRouterModel();
    return this.routerModelPromise;
  }

  private async askJson(prompt: string): Promise<string> {
    const model = await this.getRouterModel();

    // Router calls should be cheap + stable, and MUST NOT hang forever.
    const ac = new AbortController();
    const timeoutMs = 30000;
    const t = setTimeout(() => ac.abort(new Error(`router timeout after ${timeoutMs}ms`)), timeoutMs);

    try {
      const response = await completeSimple(
        model,
        {
          systemPrompt: "Return strict JSON only.",
          messages: [
            {
              role: "user",
              content: prompt,
              timestamp: Date.now(),
            },
          ],
        },
        {
          apiKey: "dummy",
          // Deterministic router behavior.
          temperature: 0,
          // Router output should be tiny; keep it tight to reduce spill/rambling.
          maxTokens: 256,
          signal: ac.signal,
          // Force JSON-only + disable thinking at the vLLM template layer.
          onPayload: (payload) => {
            if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
            const out = { ...(payload as Record<string, unknown>) };
            out["response_format"] = { type: "json_object" };
            out["chat_template_kwargs"] = { enable_thinking: false };
            return out;
          },
        },
      );

      if (response.stopReason === "error") {
        throw new Error(`Router LLM call failed: ${response.errorMessage || "unknown"}`);
      }

      return response.content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
    } finally {
      clearTimeout(t);
    }
  }

  private buildSemanticFallback(request: DelegateRequest, summaryBase: string, entry?: CatalogEntry): CatalogEntry["semantic"] {
    const task = request.task.trim().split("\n")[0] || "Task";
    return {
      title: task.slice(0, 80),
      summary: summaryBase || request.context.trim().slice(0, 240) || request.task.trim().slice(0, 240),
      tags: [request.peerName, "fallback"],
      updatedAt: new Date().toISOString(),
      source: "llm",
      confidence: "low",
      basis: {
        messageCount: entry?.stats?.messageCount,
        toolCalls: entry?.stats?.toolCalls,
        compactions: entry?.stats?.compactions,
        lastUsedAt: entry?.lastUsedAt,
      },
    };
  }

  async ensureSemantic(entry: CatalogEntry, request: DelegateRequest, reportSummary?: string): Promise<CatalogEntry> {
    const cooldown = this.config.defaults.routing?.semantic?.updateCooldownMs ?? 3600000;
    const now = Date.now();
    const last = Date.parse(entry.semantic?.updatedAt ?? "");
    const hasSemantic = !!entry.semantic?.title && !!entry.semantic?.summary && Array.isArray(entry.semantic?.tags);
    const timeStale = !Number.isFinite(last) || now - last > cooldown;

    // Delta-based triggers (prefer updating on meaningful session changes).
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

    let semantic = this.buildSemanticFallback(request, reportSummary || entry.semantic?.summary || "", entry);
    let success = false;

    for (let i = 0; i < 2; i++) {
      let raw: string;
      try {
        raw = await this.askJson(prompt);
      } catch (err: any) {
        await this.trace.append({
          type: "session_semantic_enrich_error",
          sessionId: entry.sessionId,
          peerName: entry.peerName,
          error: err?.message ?? String(err),
        });
        break;
      }

      const parsed = safeJsonParse<{ title?: string; summary?: string; tags?: string[] }>(raw);
      if (parsed?.title && parsed?.summary && Array.isArray(parsed.tags)) {
        semantic = {
          title: String(parsed.title).trim(),
          summary: String(parsed.summary).trim(),
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
        success = true;
        break;
      }

      await this.trace.append({
        type: "session_semantic_enrich_invalid_json",
        sessionId: entry.sessionId,
        peerName: entry.peerName,
        attempt: i,
        rawLen: raw.length,
        rawExcerpt: raw.slice(0, 400),
      });
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
      let raw: string;
      try {
        raw = await this.askJson(prompt);
      } catch (err: any) {
        await this.trace.append({
          type: "session_route_error",
          peerName,
          error: err?.message ?? String(err),
        });
        break;
      }

      const parsed = safeJsonParse<unknown>(raw);
      const valid = routingDecisionSchema.safeParse(parsed);
      if (!valid.success) {
        await this.trace.append({
          type: "session_route_invalid_json",
          peerName,
          attempt: i,
          rawLen: raw.length,
          rawExcerpt: raw.slice(0, 400),
        });
        continue;
      }
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
