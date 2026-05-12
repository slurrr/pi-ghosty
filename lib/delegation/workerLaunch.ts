import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { shellQuote } from "../utils/helpers.js";
import type { DelegationLaunch, DelegationReport } from "./contracts.js";

export interface DelegationJobRecord {
  version: 1;
  jobId: string;
  peerName: DelegationLaunch["peerName"];
  corroboratorSessionId: string;
  peerSessionId: string;
  sessionState: DelegationLaunch["sessionState"];
  delegationMessage: string;
  launchedAt: string;
  routing?: DelegationLaunch["routing"];
  runDir: string;
  projectDir: string;
  configPath: string;
  extensionPath: string;
  workdirMode: string;
  workDir: string;
  peerSessionDir: string;
  peerSessionPath: string;
  model?: string;
  launcher: "tmux" | "headless";
  tmux?: {
    windowName?: string;
    windowId?: string;
    paneId?: string;
    mode?: "new-window" | "reuse-window";
  };
  paths: {
    jobPath: string;
    taskPath: string;
    scriptPath: string;
    heartbeatPath: string;
    startedPath: string;
    exitedPath: string;
    exitStatusPath: string;
  };
  status: {
    phase: "created" | "launched" | "running" | "reported" | "exited" | "missing_report";
    heartbeatAt?: string;
    startedAt?: string;
    exitedAt?: string;
    exitStatus?: number;
    reportPath?: string;
    reportedAt?: string;
    note?: string;
  };
}

export interface CreateDelegationJobFilesArgs {
  runDir: string;
  projectDir: string;
  configPath: string;
  extensionPath: string;
  workdirMode: string;
  workDir: string;
  peerSessionDir: string;
  peerSessionPath: string;
  launch: DelegationLaunch;
  corroboratorSessionId: string;
  model?: string;
  launcher: "tmux" | "headless";
  keepOpen: boolean;
}

export function delegationWindowName(peerName: string, sessionId: string): string {
  return `ghosty-${peerName}-${sessionId.slice(0, 8)}`;
}

function atomicWriteJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

export function readDelegationJob(path: string): DelegationJobRecord | null {
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = raw.trim() ? (JSON.parse(raw) as DelegationJobRecord) : null;
    if (!parsed || parsed.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function updateDelegationJob(path: string, updater: (job: DelegationJobRecord) => DelegationJobRecord): DelegationJobRecord {
  const current = readDelegationJob(path);
  if (!current) throw new Error(`Missing delegation job record: ${path}`);
  const next = updater(current);
  atomicWriteJson(path, next);
  return next;
}

function renderWorkerScript(args: CreateDelegationJobFilesArgs, jobPath: string, taskPath: string, paths: DelegationJobRecord["paths"]): string {
  const modelArg = args.model?.trim() ? ` --model ${shellQuote(args.model.trim())}` : "";
  const printArg = args.keepOpen ? "" : " -p";
  const keepOpenSuffix = args.keepOpen ? `\nexec bash -i\n` : "\n";

  return `#!/usr/bin/env bash
set -uo pipefail

timestamp() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

mkdir -p ${shellQuote(dirname(paths.heartbeatPath))}
printf '%s\n' "$(timestamp)" > ${shellQuote(paths.startedPath)}
printf '%s\n' "$(timestamp)" > ${shellQuote(paths.heartbeatPath)}

(
  while true; do
    printf '%s\n' "$(timestamp)" > ${shellQuote(paths.heartbeatPath)}
    sleep 10
  done
) &
GHOSTY_HEARTBEAT_PID=$!

cleanup() {
  local status="$1"
  kill "$GHOSTY_HEARTBEAT_PID" 2>/dev/null || true
  wait "$GHOSTY_HEARTBEAT_PID" 2>/dev/null || true
  printf '%s\n' "$(timestamp)" > ${shellQuote(paths.exitedPath)}
  printf '%s\n' "$status" > ${shellQuote(paths.exitStatusPath)}
}

export GHOSTY_EXTENSION_ACTIVE=1
export GHOSTY_PROJECT_DIR=${shellQuote(args.projectDir)}
export GHOSTY_WORKDIR_MODE=${shellQuote(args.workdirMode)}
export GHOSTY_PI_RUN_DIR=${shellQuote(args.runDir)}
export GHOSTY_AGENT_CONFIG_PATH=${shellQuote(args.configPath)}
export GHOSTY_DELEGATION_JOB_PATH=${shellQuote(jobPath)}
export GHOSTY_DELEGATION_TASK_PATH=${shellQuote(taskPath)}

cd ${shellQuote(args.workDir)} || exit 97

status=0
pi${printArg} --session ${shellQuote(args.peerSessionPath)} --session-dir ${shellQuote(args.peerSessionDir)} -e ${shellQuote(args.extensionPath)} --skill ${shellQuote(resolve(args.projectDir, ".pi", "skills"))}${modelArg} @${shellQuote(taskPath)} "Read the attached delegation task file and complete it exactly. Call peer_report exactly once when finished."
status=$?
cleanup "$status"
echo "[ghosty worker] job=${args.launch.jobId} peer=${args.launch.peerName} exited status=$status"
${keepOpenSuffix}`;
}

export function createDelegationJobFiles(args: CreateDelegationJobFilesArgs): DelegationJobRecord {
  const baseDir = resolve(args.runDir, "data", "delegation-jobs", args.launch.jobId);
  mkdirSync(baseDir, { recursive: true });

  const taskPath = resolve(baseDir, "task.md");
  const jobPath = resolve(baseDir, "job.json");
  const scriptPath = resolve(baseDir, "launch-worker.sh");
  const heartbeatPath = resolve(baseDir, "heartbeat.txt");
  const startedPath = resolve(baseDir, "started.txt");
  const exitedPath = resolve(baseDir, "exited.txt");
  const exitStatusPath = resolve(baseDir, "exit-status.txt");

  writeFileSync(taskPath, `${args.launch.delegationMessage.trim()}\n`, "utf8");

  const job: DelegationJobRecord = {
    version: 1,
    jobId: args.launch.jobId,
    peerName: args.launch.peerName,
    corroboratorSessionId: args.corroboratorSessionId,
    peerSessionId: args.launch.sessionId,
    sessionState: args.launch.sessionState,
    delegationMessage: args.launch.delegationMessage,
    launchedAt: args.launch.launchedAt,
    routing: args.launch.routing,
    runDir: args.runDir,
    projectDir: args.projectDir,
    configPath: args.configPath,
    extensionPath: args.extensionPath,
    workdirMode: args.workdirMode,
    workDir: args.workDir,
    peerSessionDir: args.peerSessionDir,
    peerSessionPath: args.peerSessionPath,
    model: args.model?.trim() || undefined,
    launcher: args.launcher,
    paths: {
      jobPath,
      taskPath,
      scriptPath,
      heartbeatPath,
      startedPath,
      exitedPath,
      exitStatusPath,
    },
    status: {
      phase: "created",
    },
  };

  atomicWriteJson(jobPath, job);
  writeFileSync(scriptPath, renderWorkerScript(args, jobPath, taskPath, job.paths), "utf8");
  chmodSync(scriptPath, 0o755);
  return job;
}

export function markDelegationJobLaunched(path: string, patch: Partial<DelegationJobRecord["tmux"]> & { note?: string; phase?: DelegationJobRecord["status"]["phase"] }): DelegationJobRecord {
  return updateDelegationJob(path, (job) => ({
    ...job,
    tmux: {
      ...(job.tmux ?? {}),
      windowName: patch.windowName ?? job.tmux?.windowName,
      windowId: patch.windowId ?? job.tmux?.windowId,
      paneId: patch.paneId ?? job.tmux?.paneId,
      mode: patch.mode ?? job.tmux?.mode,
    },
    status: {
      ...job.status,
      phase: patch.phase ?? "launched",
      note: patch.note ?? job.status.note,
    },
  }));
}

export function attachDelegationReportToJob(jobPath: string, report: DelegationReport): DelegationJobRecord {
  return updateDelegationJob(jobPath, (job) => ({
    ...job,
    status: {
      ...job.status,
      phase: "reported",
      reportPath: report.reportPath,
      reportedAt: report.completedAt,
    },
  }));
}

export function markDelegationJobHeartbeat(jobPath: string, heartbeatAt: string): DelegationJobRecord {
  return updateDelegationJob(jobPath, (job) => ({
    ...job,
    status: {
      ...job.status,
      heartbeatAt,
      phase: job.status.phase === "created" || job.status.phase === "launched" ? "running" : job.status.phase,
    },
  }));
}

export function markDelegationJobExited(jobPath: string, exitedAt: string, exitStatus: number | null, note?: string): DelegationJobRecord {
  return updateDelegationJob(jobPath, (job) => ({
    ...job,
    status: {
      ...job.status,
      phase: job.status.reportPath ? "reported" : "exited",
      exitedAt,
      exitStatus: typeof exitStatus === "number" ? exitStatus : undefined,
      note: note ?? job.status.note,
    },
  }));
}

export function markDelegationJobMissingReport(jobPath: string, exitedAt: string, exitStatus: number | null, note?: string): DelegationJobRecord {
  return updateDelegationJob(jobPath, (job) => ({
    ...job,
    status: {
      ...job.status,
      phase: "missing_report",
      exitedAt,
      exitStatus: typeof exitStatus === "number" ? exitStatus : undefined,
      note: note ?? job.status.note,
    },
  }));
}
