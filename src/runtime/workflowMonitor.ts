import { appendFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export type WorkflowCandidateStatus = "candidate" | "winner" | "parked";

export interface WorkflowMonitorConfig {
  enabled: boolean;
  heartbeatMs: number;
  reviewCadenceMs: number;
  lookbackHours: number;
  candidateThreshold: number;
  winnerThreshold: number;
  surfaceTopN: number;
}

export interface WorkflowCandidate {
  id: string;
  status: WorkflowCandidateStatus;
  peerName: string;
  jobId?: string;
  sessionId?: string;
  score: number;
  wins: number;
  frictions: number;
  signals: number;
  reasons: string[];
  lastSeenAt: string;
}

export interface WorkflowSummary {
  ts: string;
  reason: string;
  windowStart: string;
  windowEnd: string;
  scanned: {
    reports: number;
    traceEvents: number;
  };
  counts: {
    winner: number;
    candidate: number;
    parked: number;
    screened: number;
  };
  candidates: WorkflowCandidate[];
  topScreened: WorkflowCandidate[];
}

interface CandidateAccumulator {
  id: string;
  peerName: string;
  jobId?: string;
  sessionId?: string;
  score: number;
  wins: number;
  frictions: number;
  signals: number;
  reasons: Map<string, number>;
  lastSeenAtMs: number;
}

function safeJsonParse<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

function toIso(ms: number): string {
  return new Date(Math.max(0, Math.trunc(ms))).toISOString();
}

function hasAnyKeyword(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  let count = 0;
  for (const k of keywords) {
    if (lower.includes(k)) count += 1;
  }
  return count;
}

function reasonList(map: Map<string, number>): string[] {
  return [...map.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([reason]) => reason);
}

function addSignal(acc: CandidateAccumulator, args: { delta: number; win?: number; friction?: number; reason: string; seenAtMs: number }): void {
  acc.score += args.delta;
  acc.wins += args.win ?? 0;
  acc.frictions += args.friction ?? 0;
  acc.signals += 1;
  acc.lastSeenAtMs = Math.max(acc.lastSeenAtMs, args.seenAtMs);
  acc.reasons.set(args.reason, (acc.reasons.get(args.reason) ?? 0) + 1);
}

function candidateStatus(acc: CandidateAccumulator, cfg: WorkflowMonitorConfig): WorkflowCandidateStatus {
  const parkedScore = cfg.candidateThreshold - 1;
  if (acc.score >= cfg.winnerThreshold && acc.wins >= acc.frictions) return "winner";
  if (acc.score >= cfg.candidateThreshold) return "candidate";
  if (acc.frictions > acc.wins || acc.score <= parkedScore) return "parked";
  return "candidate";
}

function sortCandidates(a: WorkflowCandidate, b: WorkflowCandidate): number {
  const rank = (s: WorkflowCandidateStatus) => (s === "winner" ? 0 : s === "candidate" ? 1 : 2);
  const r = rank(a.status) - rank(b.status);
  if (r !== 0) return r;
  if (a.score !== b.score) return b.score - a.score;
  if (a.wins !== b.wins) return b.wins - a.wins;
  if (a.frictions !== b.frictions) return a.frictions - b.frictions;
  if (a.lastSeenAt !== b.lastSeenAt) return b.lastSeenAt.localeCompare(a.lastSeenAt);
  return a.id.localeCompare(b.id);
}

export class WorkflowMonitor {
  private lastRunAt = 0;
  private readonly rootDir: string;
  private readonly latestPath: string;
  private readonly historyPath: string;

  constructor(private readonly runDir: string, private readonly config: WorkflowMonitorConfig) {
    this.rootDir = resolve(runDir, "data", "workflow-monitor");
    this.latestPath = resolve(this.rootDir, "latest.json");
    this.historyPath = resolve(this.rootDir, "history.jsonl");
  }

  static readLatestPath(runDir: string): string {
    return resolve(runDir, "data", "workflow-monitor", "latest.json");
  }

  static async readLatest(runDir: string): Promise<WorkflowSummary | null> {
    const path = WorkflowMonitor.readLatestPath(runDir);
    try {
      const raw = await readFile(path, "utf-8");
      return safeJsonParse<WorkflowSummary>(raw) ?? null;
    } catch {
      return null;
    }
  }

  async maybeRun(reason: string): Promise<WorkflowSummary | null> {
    if (!this.config.enabled) return null;
    const now = Date.now();
    if (now - this.lastRunAt < this.config.heartbeatMs) return null;
    return this.run(reason, now);
  }

  async run(reason: string, now = Date.now()): Promise<WorkflowSummary | null> {
    if (!this.config.enabled) return null;

    const windowMs = Math.max(1, this.config.lookbackHours) * 60 * 60 * 1000;
    const windowStartMs = now - windowMs;
    const windowEndMs = now;

    const candidates = new Map<string, CandidateAccumulator>();
    let reportCount = 0;
    let traceEvents = 0;

    const getCandidate = (id: string, peerName: string, seenAtMs: number, jobId?: string, sessionId?: string): CandidateAccumulator => {
      const existing = candidates.get(id);
      if (existing) {
        existing.lastSeenAtMs = Math.max(existing.lastSeenAtMs, seenAtMs);
        if (!existing.jobId && jobId) existing.jobId = jobId;
        if (!existing.sessionId && sessionId) existing.sessionId = sessionId;
        return existing;
      }
      const created: CandidateAccumulator = {
        id,
        peerName,
        jobId,
        sessionId,
        score: 0,
        wins: 0,
        frictions: 0,
        signals: 0,
        reasons: new Map<string, number>(),
        lastSeenAtMs: seenAtMs,
      };
      candidates.set(id, created);
      return created;
    };

    // delegation reports
    try {
      const reportsDir = resolve(this.runDir, "data", "delegation-reports");
      const names = (await readdir(reportsDir)).filter((n) => n.endsWith(".json")).sort((a, b) => a.localeCompare(b));
      for (const name of names) {
        const path = resolve(reportsDir, name);
        const raw = await readFile(path, "utf-8");
        const report = safeJsonParse<any>(raw);
        if (!report) continue;

        const completedAtMs = Date.parse(String(report.completedAt ?? ""));
        const seenAtMs = Number.isFinite(completedAtMs) ? completedAtMs : Date.now();
        if (seenAtMs < windowStartMs || seenAtMs > windowEndMs) continue;

        const peerName = String(report.peerName || "unknown");
        const jobId = report.jobId ? String(report.jobId) : undefined;
        const sessionId = report.peerSessionId ? String(report.peerSessionId) : undefined;
        const id = jobId ? `${peerName}:${jobId}` : `${peerName}:${sessionId ?? "unknown"}`;
        const acc = getCandidate(id, peerName, seenAtMs, jobId, sessionId);

        reportCount += 1;

        const summary = String(report?.output?.summary ?? "");
        const findings = Array.isArray(report?.output?.findings) ? report.output.findings.map((v: any) => String(v)).join("\n") : "";
        const nextActions = Array.isArray(report?.output?.next_actions) ? report.output.next_actions.map((v: any) => String(v)).join("\n") : "";
        const text = [summary, findings, nextActions].filter(Boolean).join("\n");

        const winHits = hasAnyKeyword(text, ["done", "fixed", "implemented", "resolved", "completed", "pass", "ok", "merged"]);
        const frictionHits = hasAnyKeyword(text, ["error", "failed", "timeout", "blocked", "retry", "fallback", "missing", "unsupported", "stuck"]);

        if (winHits > 0) addSignal(acc, { delta: winHits * 1.5, win: winHits, reason: "report_win", seenAtMs });
        if (frictionHits > 0) addSignal(acc, { delta: -(frictionHits * 1.5), friction: frictionHits, reason: "report_friction", seenAtMs });

        const artifactCount = Array.isArray(report?.output?.artifacts) ? report.output.artifacts.length : 0;
        if (artifactCount > 0) {
          addSignal(acc, { delta: Math.min(3, artifactCount * 0.5), win: 1, reason: "report_artifacts", seenAtMs });
        }

        if (String(report.reportSource || "") === "tool") {
          addSignal(acc, { delta: 0.5, win: 1, reason: "report_structured", seenAtMs });
        } else {
          addSignal(acc, { delta: -0.5, friction: 1, reason: "report_unstructured", seenAtMs });
        }
      }
    } catch {
      // no reports yet
    }

    // runtime traces
    try {
      const runtimeTraceDir = resolve(this.runDir, "data", "traces", "runtime");
      const names = (await readdir(runtimeTraceDir)).filter((n) => n.endsWith(".jsonl")).sort((a, b) => a.localeCompare(b));
      for (const name of names) {
        const path = resolve(runtimeTraceDir, name);
        const raw = await readFile(path, "utf-8");
        const lines = raw.split(/\r?\n/).filter(Boolean);
        for (const line of lines) {
          const event = safeJsonParse<any>(line);
          if (!event || typeof event !== "object") continue;
          const ts = Date.parse(String(event.ts ?? ""));
          const seenAtMs = Number.isFinite(ts) ? ts : 0;
          if (!seenAtMs || seenAtMs < windowStartMs || seenAtMs > windowEndMs) continue;

          traceEvents += 1;
          const peerName = String(event.peerName || "coordinator");
          const jobId = event.jobId ? String(event.jobId) : undefined;
          const sessionId = event.peerSessionId ? String(event.peerSessionId) : (event.sessionId ? String(event.sessionId) : undefined);
          const id = jobId ? `${peerName}:${jobId}` : `${peerName}:${sessionId ?? "unknown"}`;
          const acc = getCandidate(id, peerName, seenAtMs, jobId, sessionId);

          const type = String(event.type || "");
          if (type === "delegate_end") {
            addSignal(acc, { delta: 0.5, win: 1, reason: "delegate_end", seenAtMs });
          } else if (type === "delegate_start") {
            addSignal(acc, { delta: 0.1, reason: "delegate_start", seenAtMs });
          } else if (type === "peer_report_missing") {
            addSignal(acc, { delta: -2, friction: 2, reason: "peer_report_missing", seenAtMs });
          } else if (type === "session_route_error" || type === "delegate_postprocess_error" || type === "delegate_report_write_error") {
            addSignal(acc, { delta: -1.5, friction: 1, reason: type, seenAtMs });
          } else if (type === "session_semantic_enrich_error" || type === "delegate_semantic_error" || type === "delegate_report_injection_error") {
            addSignal(acc, { delta: -1, friction: 1, reason: type, seenAtMs });
          }
        }
      }
    } catch {
      // no traces yet
    }

    const allCandidates = [...candidates.values()].map((acc) => {
      const status = candidateStatus(acc, this.config);
      return {
        id: acc.id,
        status,
        peerName: acc.peerName,
        jobId: acc.jobId,
        sessionId: acc.sessionId,
        score: Number(acc.score.toFixed(3)),
        wins: acc.wins,
        frictions: acc.frictions,
        signals: acc.signals,
        reasons: reasonList(acc.reasons),
        lastSeenAt: toIso(acc.lastSeenAtMs || now),
      } as WorkflowCandidate;
    }).sort(sortCandidates);

    const screened = allCandidates.filter((c) => c.status === "winner" || c.status === "candidate");

    const summary: WorkflowSummary = {
      ts: toIso(now),
      reason,
      windowStart: toIso(windowStartMs),
      windowEnd: toIso(windowEndMs),
      scanned: {
        reports: reportCount,
        traceEvents,
      },
      counts: {
        winner: allCandidates.filter((c) => c.status === "winner").length,
        candidate: allCandidates.filter((c) => c.status === "candidate").length,
        parked: allCandidates.filter((c) => c.status === "parked").length,
        screened: screened.length,
      },
      candidates: allCandidates,
      topScreened: screened.slice(0, Math.max(1, this.config.surfaceTopN)),
    };

    await mkdir(this.rootDir, { recursive: true });
    const tmpPath = `${this.latestPath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(summary, null, 2)}\n`, "utf-8");
    await rename(tmpPath, this.latestPath);
    await appendFile(this.historyPath, `${JSON.stringify({ ts: summary.ts, reason: summary.reason, counts: summary.counts, scanned: summary.scanned })}\n`, "utf-8");

    this.lastRunAt = now;
    return summary;
  }
}
