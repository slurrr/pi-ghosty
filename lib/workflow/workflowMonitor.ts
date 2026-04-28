import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import type { ExtensionFactory } from "@mariozechner/pi-coding-agent";
import type { WorkflowMonitorConfig } from "../config/schema.js";

export type WorkflowSignalKind = "pain" | "win";
export type WorkflowCandidateStatus = "candidate" | "winner" | "parked";

export interface WorkflowSignalEvidence {
  ts: string;
  sourcePath: string;
  traceScope: string;
  agentName: string | null;
  sessionId: string | null;
  eventType: string;
  detail: string;
}

export interface WorkflowCandidateRecord {
  id: string;
  kind: WorkflowSignalKind;
  status: WorkflowCandidateStatus;
  category: string;
  title: string;
  summary: string;
  recommendation: string;
  score: number;
  count: number;
  firstSeen: string;
  lastSeen: string;
  evidence: WorkflowSignalEvidence[];
}

export interface WorkflowReviewRecord {
  ts: string;
  reason: string;
  projectTag: string;
  windowStart: string;
  windowEnd: string;
  windowHours: number;
  sourceCount: number;
  signalCount: number;
  candidateCount: number;
  winnerCount: number;
  parkedCount: number;
  counts: {
    winner: number;
    candidate: number;
    parked: number;
    screened: number;
  };
  candidates: WorkflowCandidateRecord[];
  winners: WorkflowCandidateRecord[];
  parked: WorkflowCandidateRecord[];
  topScreened: WorkflowCandidateRecord[];
}

interface WorkflowState {
  lastReviewAt: string | null;
  lastProcessedAt: string | null;
  surfacedIds: Record<string, WorkflowCandidateStatus>;
}

interface WorkflowSignalSeed {
  kind: WorkflowSignalKind;
  category: string;
  title: string;
  summary: string;
  recommendation: string;
  score: number;
  fingerprint: string;
  evidence: WorkflowSignalEvidence;
}

interface WorkflowSourceFile {
  sourcePath: string;
  traceScope: string;
  agentName: string | null;
  sessionId: string | null;
}

interface WorkflowMonitorArgs {
  projectTag: string;
  runDir: string;
  agentName: string;
  config: WorkflowMonitorConfig;
}

const workflowMonitorSingletonKey = Symbol.for("ghosty.workflowMonitorSingleton");

function stableHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function safeReadJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!existsSync(filePath)) return fallback;
    const raw = readFileSync(filePath, "utf8");
    if (!raw.trim()) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tmpPath, filePath);
}

function appendJsonl(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value)}\n`, { encoding: "utf8", flag: "a" });
}

function walkJsonlFiles(rootDir: string): string[] {
  if (!existsSync(rootDir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    const full = resolve(rootDir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkJsonlFiles(full));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      out.push(full);
    }
  }
  return out;
}

function readJsonlRecords<T extends Record<string, unknown>>(filePath: string): T[] {
  try {
    const raw = readFileSync(filePath, "utf8");
    if (!raw.trim()) return [];
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as T];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

function toIsoTimestamp(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    const d = new Date(value.trim());
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

function parseSourceFile(runDir: string, filePath: string): WorkflowSourceFile {
  const tracesRoot = resolve(runDir, "data", "traces");
  const rel = filePath.startsWith(tracesRoot) ? filePath.slice(tracesRoot.length + 1) : basename(filePath);
  const parts = rel.split(/[\\/]/).filter(Boolean);
  const traceScope = parts[0] ?? "unknown";
  const sessionId = parts.length > 1 ? parts[parts.length - 1].replace(/\.jsonl$/, "") : null;
  return {
    sourcePath: filePath,
    traceScope,
    agentName: traceScope === "runtime" ? null : traceScope,
    sessionId,
  };
}

function createEvidence(source: WorkflowSourceFile, eventType: string, detail: string, ts: string): WorkflowSignalEvidence {
  return {
    ts,
    sourcePath: source.sourcePath,
    traceScope: source.traceScope,
    agentName: source.agentName,
    sessionId: source.sessionId,
    eventType,
    detail,
  };
}

function signalFingerprint(parts: Array<string | null | undefined>): string {
  return stableHash(parts.filter((p): p is string => !!p && p.trim().length > 0).join("|"));
}

function signalSeedFromEvent(event: Record<string, unknown>, source: WorkflowSourceFile): WorkflowSignalSeed[] {
  const type = String(event.type ?? "").trim();
  if (!type) return [];
  const ts = toIsoTimestamp((event as any).ts) ?? new Date().toISOString();
  const peerName = typeof event.peerName === "string" ? event.peerName : source.agentName ?? source.traceScope;
  const sessionId = typeof event.sessionId === "string" ? event.sessionId : source.sessionId;
  const error = typeof event.error === "string" ? event.error : typeof event.reason === "string" ? event.reason : null;
  const action = typeof event.action === "string" ? event.action : null;

  const mk = (payload: {
    kind: WorkflowSignalKind;
    category: string;
    title: string;
    summary: string;
    recommendation: string;
    score: number;
    signatureParts: Array<string | null | undefined>;
    detail: string;
  }): WorkflowSignalSeed => ({
    kind: payload.kind,
    category: payload.category,
    title: payload.title,
    summary: payload.summary,
    recommendation: payload.recommendation,
    score: payload.score,
    fingerprint: signalFingerprint([payload.kind, payload.category, payload.title, ...payload.signatureParts]),
    evidence: createEvidence(source, type, payload.detail, ts),
  });

  switch (type) {
    case "session_route_error":
      return [
        mk({
          kind: "pain",
          category: "context-alignment",
          title: "context re-establishment is failing",
          summary: error ? `routing hit an error: ${error}` : "routing could not settle on a session cleanly",
          recommendation: "keep stronger session state around so the system can recover without re-litigating the same context",
          score: 4,
          signatureParts: [peerName, error],
          detail: error ?? "session route error",
        }),
      ];

    case "session_route_invalid_json":
      return [
        mk({
          kind: "pain",
          category: "context-alignment",
          title: "routing outputs are too brittle",
          summary: "the router returned invalid JSON and had to be ignored",
          recommendation: "tighten the routing contract or avoid model-based routing when deterministic defaults are enough",
          score: 4,
          signatureParts: [peerName, "invalid_json"],
          detail: error ?? "session route invalid json",
        }),
      ];

    case "session_route_decision": {
      const reason = String(event.reason ?? "").trim();
      if (action === "new" && reason.toLowerCase().includes("fallback")) {
        return [
          mk({
            kind: "pain",
            category: "context-alignment",
            title: "peer routing keeps falling back to the wrong thing",
            summary: reason || "the router fell back to the most recent session",
            recommendation: "surface a better default session state before the next turn so routing does not need to guess",
            score: 3,
            signatureParts: [peerName, reason || "fallback"],
            detail: reason || "fallback routing",
          }),
        ];
      }
      if (action === "resume" && reason === "single candidate") {
        return [
          mk({
            kind: "win",
            category: "context-alignment",
            title: "routing found the right prior session quickly",
            summary: "session routing resumed a single clear candidate without drama",
            recommendation: "keep the routing defaults and candidate filtering that make the next turn obvious",
            score: 1,
            signatureParts: [peerName, "single candidate"],
            detail: "single candidate resume",
          }),
        ];
      }
      return [];
    }

    case "session_semantic_enrich_error":
      return [
        mk({
          kind: "pain",
          category: "context-alignment",
          title: "session summaries are not enriching cleanly",
          summary: error ? `semantic enrichment failed: ${error}` : "semantic enrichment failed",
          recommendation: "make session summaries more deterministic or reduce dependence on enrichment during routing",
          score: 2,
          signatureParts: [peerName, error],
          detail: error ?? "semantic enrich error",
        }),
      ];

    case "session_semantic_enrich_invalid_json":
      return [
        mk({
          kind: "pain",
          category: "context-alignment",
          title: "session semantic enrichment is too loose",
          summary: "semantic enrichment returned invalid JSON",
          recommendation: "treat this as a best-effort hint, not a hard dependency",
          score: 2,
          signatureParts: [peerName, "invalid_json"],
          detail: "invalid json",
        }),
      ];

    case "delegate_postprocess_error":
      return [
        mk({
          kind: "pain",
          category: "handoff-integrity",
          title: "peer handoffs are being dropped after completion",
          summary: error ? `post-processing failed: ${error}` : "a peer finished but the handoff cleanup failed",
          recommendation: "keep the report/write/follow-up path atomic so a finished peer job always reaches the coordinator",
          score: 5,
          signatureParts: [peerName, error],
          detail: error ?? "delegate postprocess error",
        }),
      ];

    case "delegate_report_write_error":
      return [
        mk({
          kind: "pain",
          category: "handoff-integrity",
          title: "peer reports are not durable enough",
          summary: error ? `report write failed: ${error}` : "a peer report could not be written",
          recommendation: "write peer results to disk before trying to surface them",
          score: 6,
          signatureParts: [peerName, error],
          detail: error ?? "delegate report write error",
        }),
      ];

    case "delegate_report_injection_error":
      return [
        mk({
          kind: "pain",
          category: "handoff-integrity",
          title: "peer results are not reaching the coordinator",
          summary: error ? `report injection failed: ${error}` : "a peer result could not be injected back into the coordinator session",
          recommendation: "keep a durable return path even when the interactive injection layer is having a bad day",
          score: 6,
          signatureParts: [peerName, error],
          detail: error ?? "delegate report injection error",
        }),
      ];

    case "delegate_semantic_error":
      return [
        mk({
          kind: "pain",
          category: "handoff-integrity",
          title: "peer summaries are too fuzzy",
          summary: error ? `semantic enrichment on a peer result failed: ${error}` : "peer summary enrichment failed",
          recommendation: "keep the raw peer output visible and do not depend on a semantic polish pass to preserve the result",
          score: 3,
          signatureParts: [peerName, error],
          detail: error ?? "delegate semantic error",
        }),
      ];

    case "delegate_end":
      if (String(event.reportSource ?? "") === "tool") {
        return [
          mk({
            kind: "win",
            category: "handoff-integrity",
            title: "peer handoffs are landing cleanly",
            summary: "a peer finished and reported back through the tool path",
            recommendation: "keep the non-blocking peer report path as a core habit",
            score: 2,
            signatureParts: [peerName, String(event.routingAction ?? ""), "tool"],
            detail: `peer ${peerName} reported via tool`,
          }),
        ];
      }
      return [];

    case "memory_recall_error":
      return [
        mk({
          kind: "pain",
          category: "memory-stability",
          title: "memory recall is getting in the way",
          summary: error ? `recall failed: ${error}` : "memory recall failed",
          recommendation: "keep recall best-effort and bounded so the core flow does not have to fight the memory layer",
          score: 4,
          signatureParts: [peerName, error],
          detail: error ?? "memory recall error",
        }),
      ];

    case "memory_retain_error":
      return [
        mk({
          kind: "pain",
          category: "memory-stability",
          title: "memory writes are not sticking",
          summary: error ? `retain failed: ${error}` : "memory retain failed",
          recommendation: "keep the memory write path durable and boring so the rest of the system can trust it",
          score: 5,
          signatureParts: [peerName, error],
          detail: error ?? "memory retain error",
        }),
      ];

    case "memory_operation_status": {
      const status = String(event.status ?? "").toLowerCase();
      if (["timeout", "failed", "error", "not_found"].includes(status)) {
        return [
          mk({
            kind: "pain",
            category: "memory-stability",
            title: "memory operations are not finishing reliably",
            summary: `memory operation ended with ${status}`,
            recommendation: "do not block the session on memory completion unless the situation really needs it",
            score: 3,
            signatureParts: [peerName, status, String(event.operationId ?? "")],
            detail: `status=${status}`,
          }),
        ];
      }
      return [];
    }

    case "memory_recall": {
      const injectedLines = Number(event.injectedLines ?? 0);
      const factsCount = Number(event.factsCount ?? 0);
      if (injectedLines > 0 || factsCount > 0) {
        return [
          mk({
            kind: "win",
            category: "memory-stability",
            title: "memory recall is providing useful context",
            summary: injectedLines > 0 ? `${injectedLines} recalled lines were injected` : `${factsCount} facts were available for recall`,
            recommendation: "keep the memory path wired because it is pulling its weight when it shows up",
            score: 1,
            signatureParts: [peerName, String(injectedLines), String(factsCount)],
            detail: `injectedLines=${injectedLines} factsCount=${factsCount}`,
          }),
        ];
      }
      return [];
    }

    case "tool_policy_block":
      return [
        mk({
          kind: "pain",
          category: "tool-friction",
          title: "tool policy is fighting normal work",
          summary: `blocked ${String(event.toolName ?? "tool")} because ${String(event.reason ?? "unknown reason")}`,
          recommendation: "tighten the allowlist only where it actually protects the project and stop punishing normal movement",
          score: 3,
          signatureParts: [String(event.toolName ?? ""), String(event.reason ?? "")],
          detail: String(event.reason ?? "tool policy block"),
        }),
      ];

    case "tool_gating_block":
      return [
        mk({
          kind: "pain",
          category: "tool-friction",
          title: "tool gating is blocking useful work",
          summary: `gating blocked ${String(event.toolName ?? "tool")}`,
          recommendation: "keep the gate narrow and intentional so it does not become accidental bureaucracy",
          score: 3,
          signatureParts: [String(event.toolName ?? ""), String(event.reason ?? "")],
          detail: String(event.reason ?? "tool gating block"),
        }),
      ];

    case "tool_result":
      if (event.isError === true) {
        return [
          mk({
            kind: "pain",
            category: "tool-friction",
            title: `${String(event.toolName ?? "tool")} is erroring`,
            summary: `${String(event.toolName ?? "tool")} returned an error`,
            recommendation: "make the failure mode visible and stop asking the same broken tool path to magically recover",
            score: 2,
            signatureParts: [String(event.toolName ?? ""), String(event.toolCallId ?? "")],
            detail: `${String(event.toolName ?? "tool")} error`,
          }),
        ];
      }
      return [];

    default:
      return [];
  }
}

function mergeSignals(seeds: WorkflowSignalSeed[], config: WorkflowMonitorConfig): WorkflowCandidateRecord[] {
  const byFingerprint = new Map<string, WorkflowCandidateRecord>();

  for (const seed of seeds) {
    const existing = byFingerprint.get(seed.fingerprint);
    if (!existing) {
      const status = seed.score >= config.winnerThreshold ? "winner" : seed.score >= config.candidateThreshold ? "candidate" : "parked";
      byFingerprint.set(seed.fingerprint, {
        id: seed.fingerprint,
        kind: seed.kind,
        status,
        category: seed.category,
        title: seed.title,
        summary: seed.summary,
        recommendation: seed.recommendation,
        score: seed.score,
        count: 1,
        firstSeen: seed.evidence.ts,
        lastSeen: seed.evidence.ts,
        evidence: [seed.evidence],
      });
      continue;
    }

    existing.score += seed.score;
    existing.count += 1;
    existing.lastSeen = seed.evidence.ts > existing.lastSeen ? seed.evidence.ts : existing.lastSeen;
    existing.firstSeen = seed.evidence.ts < existing.firstSeen ? seed.evidence.ts : existing.firstSeen;
    existing.evidence.push(seed.evidence);
    if (existing.evidence.length > 5) existing.evidence = existing.evidence.slice(-5);
    existing.status = existing.score >= config.winnerThreshold ? "winner" : existing.score >= config.candidateThreshold ? "candidate" : "parked";
  }

  return [...byFingerprint.values()].sort((a, b) => {
    if (a.status !== b.status) return a.status === "winner" ? -1 : b.status === "winner" ? 1 : a.status === "candidate" ? -1 : 1;
    if (a.score !== b.score) return b.score - a.score;
    if (a.count !== b.count) return b.count - a.count;
    return b.lastSeen.localeCompare(a.lastSeen);
  });
}

function formatCountLabel(count: number): string {
  return `${count}x`;
}

export class WorkflowMonitor {
  private ctx: any | undefined;
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<WorkflowReviewRecord | null> | null = null;
  private state: WorkflowState;
  private latestReview: WorkflowReviewRecord | null = null;

  constructor(private readonly args: WorkflowMonitorArgs) {
    const root = this.workflowDir();
    mkdirSync(root, { recursive: true });
    this.state = safeReadJsonFile<WorkflowState>(this.statePath(), {
      lastReviewAt: null,
      lastProcessedAt: null,
      surfacedIds: {},
    });
    if (!this.state.lastProcessedAt) {
      const defaultSince = new Date(Date.now() - args.config.lookbackHours * 60 * 60 * 1000).toISOString();
      this.state.lastProcessedAt = defaultSince;
    }
  }

  attach(ctx: any): void {
    this.ctx = ctx;
    this.ensureTimer();
    void this.maybeReview("session_start");
  }

  async runNow(reason = "manual"): Promise<WorkflowReviewRecord | null> {
    return this.runReview(reason, true);
  }

  async run(reason = "manual"): Promise<WorkflowReviewRecord | null> {
    return this.runNow(reason);
  }

  async maybeReview(reason = "heartbeat"): Promise<WorkflowReviewRecord | null> {
    if (!this.args.config.enabled) return null;
    const lastReviewMs = this.state.lastReviewAt ? Date.parse(this.state.lastReviewAt) : 0;
    const due = !lastReviewMs || Date.now() - lastReviewMs >= this.args.config.reviewCadenceMs;
    if (!due && reason !== "session_start") return null;
    return this.runReview(reason, false);
  }

  async maybeRun(reason = "heartbeat"): Promise<WorkflowReviewRecord | null> {
    return this.maybeReview(reason);
  }

  status(): {
    enabled: boolean;
    heartbeatMs: number;
    reviewCadenceMs: number;
    lastReviewAt: string | null;
    nextReviewAt: string | null;
    candidateCount: number;
    winnerCount: number;
    parkedCount: number;
    topCandidates: WorkflowCandidateRecord[];
    topWinners: WorkflowCandidateRecord[];
  } {
    const review = this.latestReview;
    const lastReviewAt = this.state.lastReviewAt;
    const nextReviewAt = lastReviewAt ? new Date(Date.parse(lastReviewAt) + this.args.config.reviewCadenceMs).toISOString() : null;
    return {
      enabled: this.args.config.enabled,
      heartbeatMs: this.args.config.heartbeatMs,
      reviewCadenceMs: this.args.config.reviewCadenceMs,
      lastReviewAt,
      nextReviewAt,
      candidateCount: review?.candidateCount ?? 0,
      winnerCount: review?.winnerCount ?? 0,
      parkedCount: review?.parkedCount ?? 0,
      topCandidates: review?.candidates.slice(0, this.args.config.surfaceTopN) ?? [],
      topWinners: review?.winners.slice(0, this.args.config.surfaceTopN) ?? [],
    };
  }

  describe(): string {
    const status = this.status();
    const lines = [
      "workflow monitor",
      `enabled: ${status.enabled}`,
      `heartbeatMs: ${status.heartbeatMs}`,
      `reviewCadenceMs: ${status.reviewCadenceMs}`,
      `lastReviewAt: ${status.lastReviewAt ?? "never"}`,
      `nextReviewAt: ${status.nextReviewAt ?? "n/a"}`,
      `winners: ${status.winnerCount}`,
      `candidates: ${status.candidateCount}`,
      `parked: ${status.parkedCount}`,
    ];

    if (status.topWinners.length > 0) {
      lines.push("top winners:");
      for (const item of status.topWinners) {
        lines.push(`- [${item.kind}] ${item.title} (${formatCountLabel(item.count)}, score ${item.score})`);
      }
    }

    if (status.topCandidates.length > 0) {
      lines.push("top candidates:");
      for (const item of status.topCandidates) {
        lines.push(`- [${item.kind}] ${item.title} (${formatCountLabel(item.count)}, score ${item.score})`);
      }
    }

    return lines.join("\n");
  }

  private ensureTimer(): void {
    if (!this.args.config.enabled) return;
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.maybeReview("heartbeat");
    }, this.args.config.heartbeatMs);
    this.timer.unref?.();
  }

  private workflowDir(): string {
    return resolve(this.args.runDir, "data", "workflow");
  }

  private statePath(): string {
    return resolve(this.workflowDir(), "state.json");
  }

  private latestPath(): string {
    return resolve(this.workflowDir(), "latest.json");
  }

  static readLatestPath(runDir: string): string {
    return resolve(runDir, "data", "workflow", "latest.json");
  }

  static readLatest(runDir: string): Promise<WorkflowReviewRecord | null> {
    try {
      const raw = readFileSync(WorkflowMonitor.readLatestPath(runDir), "utf8");
      if (!raw.trim()) return Promise.resolve(null);
      return Promise.resolve(JSON.parse(raw) as WorkflowReviewRecord);
    } catch {
      return Promise.resolve(null);
    }
  }

  private signalsPath(): string {
    return resolve(this.workflowDir(), "signals.jsonl");
  }

  private candidateLogPath(): string {
    return resolve(this.workflowDir(), "candidates.jsonl");
  }

  private reviewPath(ts: string): string {
    const safeTs = ts.replace(/:/g, "-");
    return resolve(this.workflowDir(), "reviews", `${safeTs}.json`);
  }

  private async runReview(reason: string, force: boolean): Promise<WorkflowReviewRecord | null> {
    if (!this.args.config.enabled) return null;
    if (this.running) return this.running;

    this.running = this.performReview(reason, force).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async performReview(reason: string, force: boolean): Promise<WorkflowReviewRecord | null> {
    const startedAt = new Date().toISOString();
    const cutoff = this.state.lastProcessedAt ?? new Date(Date.now() - this.args.config.lookbackHours * 60 * 60 * 1000).toISOString();
    const tracesRoot = resolve(this.args.runDir, "data", "traces");
    const files = walkJsonlFiles(tracesRoot);
    const signals: WorkflowSignalSeed[] = [];

    for (const filePath of files) {
      const source = parseSourceFile(this.args.runDir, filePath);
      const records = readJsonlRecords<Record<string, unknown>>(filePath);
      for (const record of records) {
        const ts = toIsoTimestamp(record.ts) ?? null;
        if (!ts) continue;
        if (!force && ts <= cutoff) continue;
        for (const signal of signalSeedFromEvent(record, source)) {
          signals.push(signal);
        }
      }
    }

    const merged = mergeSignals(signals, this.args.config);
    const candidates = merged.filter((candidate) => candidate.score >= this.args.config.candidateThreshold);
    const winners = candidates.filter((candidate) => candidate.status === "winner");
    const parked = merged.filter((candidate) => candidate.score < this.args.config.candidateThreshold);
    const review: WorkflowReviewRecord = {
      ts: startedAt,
      reason,
      projectTag: this.args.projectTag,
      windowStart: cutoff,
      windowEnd: startedAt,
      windowHours: this.args.config.lookbackHours,
      sourceCount: files.length,
      signalCount: signals.length,
      candidateCount: candidates.length,
      winnerCount: winners.length,
      parkedCount: parked.length,
      counts: {
        winner: winners.length,
        candidate: candidates.filter((candidate) => candidate.status === "candidate").length,
        parked: parked.length,
        screened: candidates.length,
      },
      candidates: candidates.slice(0, this.args.config.surfaceTopN),
      winners: winners.slice(0, this.args.config.surfaceTopN),
      parked: parked.slice(0, this.args.config.surfaceTopN),
      topScreened: candidates.slice(0, this.args.config.surfaceTopN),
    };

    mkdirSync(this.workflowDir(), { recursive: true });
    appendJsonl(this.signalsPath(), { ts: startedAt, reason, signalCount: signals.length, signals: signals.slice(0, 50) });
    writeJsonAtomic(this.latestPath(), review);
    writeJsonAtomic(this.reviewPath(startedAt), review);

    const surfacedWinnerIds: string[] = [];
    for (const winner of winners) {
      const previous = this.state.surfacedIds[winner.id];
      if (previous === "winner") continue;
      surfacedWinnerIds.push(winner.id);
      appendJsonl(this.candidateLogPath(), { ts: startedAt, reviewReason: reason, record: winner });
    }
    for (const candidate of candidates) {
      if (candidate.status === "winner") continue;
      const previous = this.state.surfacedIds[candidate.id];
      if (previous) continue;
      appendJsonl(this.candidateLogPath(), { ts: startedAt, reviewReason: reason, record: candidate });
      this.state.surfacedIds[candidate.id] = candidate.status;
    }
    for (const id of surfacedWinnerIds) {
      this.state.surfacedIds[id] = "winner";
    }

    this.state.lastReviewAt = startedAt;
    this.state.lastProcessedAt = startedAt;
    writeJsonAtomic(this.statePath(), this.state);
    this.latestReview = review;

    const newWinners = surfacedWinnerIds.length > 0 && !force ? winners.filter((winner) => surfacedWinnerIds.includes(winner.id)) : [];
    if (newWinners.length > 0) {
      const message = [
        `ghosty workflow: ${newWinners.length} winner${newWinners.length === 1 ? "" : "s"} surfaced`,
        ...newWinners.slice(0, this.args.config.surfaceTopN).map((winner) => `- [${winner.kind}] ${winner.title} (${winner.count}x, score ${winner.score})`),
      ].join("\n");
      this.notify(message, "info");
    }

    return review;
  }

  private notify(message: string, level: "info" | "warning" | "error" = "info"): void {
    try {
      const notify = this.ctx?.ui?.notify;
      if (typeof notify === "function") {
        notify.call(this.ctx.ui, message, level);
        return;
      }
    } catch {
      // ignore
    }
    if (level === "error") {
      console.error(message);
    } else {
      console.log(message);
    }
  }
}

export function workflowMonitorExtensionFactory(args: WorkflowMonitorArgs): ExtensionFactory {
  if (args.agentName !== "coordinator") {
    return () => undefined;
  }

  const monitor = getWorkflowMonitor(args);
  return (pi) => {
    pi.on("session_start", async (_event: any, ctx: any) => {
      monitor.attach(ctx);
      return undefined;
    });

    pi.on("agent_start", async (_event: any, ctx: any) => {
      monitor.attach(ctx);
      return undefined;
    });
  };
}

export function getWorkflowMonitor(args: WorkflowMonitorArgs): WorkflowMonitor {
  const globalState = globalThis as typeof globalThis & {
    [workflowMonitorSingletonKey]?: Map<string, WorkflowMonitor>;
  };
  if (!globalState[workflowMonitorSingletonKey]) {
    globalState[workflowMonitorSingletonKey] = new Map();
  }
  const key = `${args.runDir}::${args.projectTag}`;
  const existing = globalState[workflowMonitorSingletonKey]!.get(key);
  if (existing) return existing;
  const monitor = new WorkflowMonitor(args);
  globalState[workflowMonitorSingletonKey]!.set(key, monitor);
  return monitor;
}
