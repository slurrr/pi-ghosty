import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { shellQuote } from "../utils/helpers.js";

export interface TmuxLaunchResult {
  launcher: "tmux";
  mode: "new-window" | "reuse-window";
  windowName: string;
  windowId?: string;
  paneId?: string;
}

export interface WarRoomLayout {
  workerSessionName: string;
  workerPaneId: string;
  statusPaneId: string;
}

interface WarRoomState extends WarRoomLayout {
  version: 1;
}

function tmux(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const res = spawnSync("tmux", args, { encoding: "utf8" });
  return {
    status: res.status,
    stdout: res.stdout || "",
    stderr: res.stderr || "",
  };
}

function atomicWriteJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

function readJson<T>(path: string): T | null {
  try {
    const raw = readFileSync(path, "utf8").trim();
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function paneExists(paneId: string): boolean {
  const res = tmux(["list-panes", "-a", "-F", "#{pane_id}"]);
  if (res.status !== 0) return false;
  return res.stdout.split(/\r?\n/).map((s) => s.trim()).includes(paneId);
}

function sessionExists(sessionName: string): boolean {
  const res = tmux(["has-session", "-t", sessionName]);
  return res.status === 0;
}

function windowExists(sessionName: string, windowName: string): boolean {
  const res = tmux(["list-windows", "-t", sessionName, "-F", "#{window_name}"]);
  if (res.status !== 0) return false;
  return res.stdout.split(/\r?\n/).map((s) => s.trim()).includes(windowName);
}

function windowInfo(sessionName: string, windowName: string): { windowId?: string; paneId?: string } {
  const res = tmux(["list-windows", "-t", sessionName, "-F", "#{window_name}|#{window_id}|#{pane_id}"]);
  if (res.status !== 0) return {};
  for (const line of res.stdout.split(/\r?\n/)) {
    const [name, windowId, paneId] = line.trim().split("|");
    if (name === windowName) return { windowId, paneId };
  }
  return {};
}

function currentPaneId(): string {
  const res = tmux(["display-message", "-p", "#{pane_id}"]);
  if (res.status !== 0) throw new Error(`tmux display-message failed: ${(res.stderr || res.stdout).trim()}`);
  return res.stdout.trim();
}

function workerSessionNameForCoordinator(coordinatorSessionId: string): string {
  return `ghosty-workers-${coordinatorSessionId.slice(0, 8)}`;
}

function warRoomStatePath(runDir: string, coordinatorSessionId: string): string {
  return resolve(runDir, "data", "war-room", `${coordinatorSessionId}.json`);
}

function configureWorkerSession(sessionName: string): void {
  tmux(["set-option", "-t", sessionName, "prefix", "C-a"]);
  tmux(["unbind-key", "-t", sessionName, "C-b"]);
  tmux(["bind-key", "-t", sessionName, "C-a", "send-prefix"]);
  tmux(["set-option", "-t", sessionName, "renumber-windows", "on"]);
  tmux(["set-option", "-t", sessionName, "status-left", "[workers prefix C-a]"]);
  tmux(["set-option", "-t", sessionName, "status-right", ""]);
}

function ensureWorkerSession(sessionName: string, workDir: string): void {
  if (!sessionExists(sessionName)) {
    const res = tmux(["new-session", "-d", "-s", sessionName, "-n", "idle", "-c", workDir]);
    if (res.status !== 0) throw new Error(`tmux new-session failed: ${(res.stderr || res.stdout).trim()}`);
  }
  configureWorkerSession(sessionName);
}

function statusPaneCommand(boardScriptPath: string, coordinatorSessionId: string): string {
  return `GHOSTY_COORDINATOR_SESSION_ID=${shellQuote(coordinatorSessionId)} node ${shellQuote(boardScriptPath)}`;
}

function workerPaneCommand(workerSessionName: string): string {
  return `unset TMUX; exec tmux attach-session -t ${shellQuote(workerSessionName)}`;
}

function ensureWarRoomPanes(workDir: string, workerSessionName: string, boardScriptPath: string, coordinatorSessionId: string): WarRoomLayout {
  const coordinatorPaneId = currentPaneId();

  const splitWorker = tmux([
    "split-window",
    "-h",
    "-p",
    "50",
    "-d",
    "-P",
    "-F",
    "#{pane_id}",
    "-c",
    workDir,
    "bash",
  ]);
  if (splitWorker.status !== 0) throw new Error(`tmux split-window worker failed: ${(splitWorker.stderr || splitWorker.stdout).trim()}`);
  const workerPaneId = splitWorker.stdout.trim();

  const splitStatus = tmux([
    "split-window",
    "-t",
    workerPaneId,
    "-v",
    "-p",
    "30",
    "-d",
    "-P",
    "-F",
    "#{pane_id}",
    "-c",
    workDir,
    "bash",
  ]);
  if (splitStatus.status !== 0) throw new Error(`tmux split-window status failed: ${(splitStatus.stderr || splitStatus.stdout).trim()}`);
  const statusPaneId = splitStatus.stdout.trim();

  reattachWorkerPane(workerPaneId, workerSessionName, workDir);
  reattachStatusPane(statusPaneId, boardScriptPath, coordinatorSessionId, workDir);
  tmux(["select-pane", "-t", coordinatorPaneId]);

  return {
    workerSessionName,
    workerPaneId,
    statusPaneId,
  };
}

function reattachWorkerPane(workerPaneId: string, workerSessionName: string, workDir: string): void {
  const res = tmux(["respawn-pane", "-k", "-t", workerPaneId, "-c", workDir, workerPaneCommand(workerSessionName)]);
  if (res.status !== 0) throw new Error(`tmux respawn-pane worker failed: ${(res.stderr || res.stdout).trim()}`);
}

function reattachStatusPane(statusPaneId: string, boardScriptPath: string, coordinatorSessionId: string, workDir: string): void {
  const res = tmux(["respawn-pane", "-k", "-t", statusPaneId, "-c", workDir, statusPaneCommand(boardScriptPath, coordinatorSessionId)]);
  if (res.status !== 0) throw new Error(`tmux respawn-pane status failed: ${(res.stderr || res.stdout).trim()}`);
}

export function ensureWarRoomLayout(args: {
  coordinatorSessionId: string;
  runDir: string;
  workDir: string;
  boardScriptPath: string;
}): WarRoomLayout {
  const { coordinatorSessionId, runDir, workDir, boardScriptPath } = args;
  const sessionName = workerSessionNameForCoordinator(coordinatorSessionId);
  ensureWorkerSession(sessionName, workDir);

  const statePath = warRoomStatePath(runDir, coordinatorSessionId);
  const existing = readJson<WarRoomState>(statePath);
  if (existing && paneExists(existing.workerPaneId) && paneExists(existing.statusPaneId)) {
    return existing;
  }

  const created = ensureWarRoomPanes(workDir, sessionName, boardScriptPath, coordinatorSessionId);
  atomicWriteJson(statePath, {
    version: 1,
    ...created,
  } satisfies WarRoomState);
  return created;
}

export interface launchTmuxWorkerOptions {
  workerSessionName: string;
  windowName: string;
  scriptPath: string;
  workDir: string;
}

function maybeKillIdleWindow(workerSessionName: string): void {
  if (!windowExists(workerSessionName, "idle")) return;
  const res = tmux(["list-windows", "-t", workerSessionName, "-F", "#{window_name}"]);
  if (res.status !== 0) return;
  const names = res.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (names.length <= 1) return;
  tmux(["kill-window", "-t", `${workerSessionName}:idle`]);
}

export function launchTmuxWorker(options: launchTmuxWorkerOptions): TmuxLaunchResult {
  const { workerSessionName, windowName, scriptPath, workDir } = options;
  const command = `bash -lc ${shellQuote(scriptPath)}`;

  if (windowExists(workerSessionName, windowName)) {
    maybeKillIdleWindow(workerSessionName);
    tmux(["select-window", "-t", `${workerSessionName}:${windowName}`]);
    const send = tmux([
      "send-keys",
      "-t",
      `${workerSessionName}:${windowName}`,
      "C-c",
      `cd ${shellQuote(workDir)}`,
      "C-m",
      command,
      "C-m",
    ]);
    if (send.status !== 0) {
      throw new Error(`tmux send-keys failed: ${(send.stderr || send.stdout).trim()}`);
    }
    const info = windowInfo(workerSessionName, windowName);
    return {
      launcher: "tmux",
      mode: "reuse-window",
      windowName,
      windowId: info.windowId,
      paneId: info.paneId,
    };
  }

  const create = tmux([
    "new-window",
    "-t",
    workerSessionName,
    "-P",
    "-F",
    "#{window_id}|#{pane_id}|#{window_name}",
    "-n",
    windowName,
    "-c",
    workDir,
    command,
  ]);
  if (create.status !== 0) {
    throw new Error(`tmux new-window failed: ${(create.stderr || create.stdout).trim()}`);
  }
  const [windowId, paneId, createdName] = create.stdout.trim().split("|");
  maybeKillIdleWindow(workerSessionName);
  tmux(["select-window", "-t", `${workerSessionName}:${createdName || windowName}`]);

  return {
    launcher: "tmux",
    mode: "new-window",
    windowName: createdName || windowName,
    windowId,
    paneId,
  };
}
