import { mkdir, readdir, rename, stat, unlink, appendFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

export interface JsonlTraceOptions {
  maxBytes?: number;
  maxFiles?: number;
  defaultMetadata?: Record<string, unknown>;
}

export function legacyTraceMetadata(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    runtimeMode: "legacy",
    ...extra,
  };
}

export class JsonlTrace {
  private readonly maxBytes: number;
  private readonly maxFiles: number;
  private readonly defaultMetadata: Record<string, unknown>;

  constructor(
    private readonly filePath: string,
    options: JsonlTraceOptions = {},
  ) {
    this.maxBytes = options.maxBytes ?? 5_000_000;
    this.maxFiles = options.maxFiles ?? 5;
    this.defaultMetadata = options.defaultMetadata ?? {};
  }

  static forAgent(runDir: string, agentName: string, sessionId: string, options: JsonlTraceOptions = {}): JsonlTrace {
    return new JsonlTrace(resolve(runDir, "data", "traces", agentName, `${sessionId}.jsonl`), options);
  }

  static forRuntime(runDir: string, sessionId: string, options: JsonlTraceOptions = {}): JsonlTrace {
    return new JsonlTrace(resolve(runDir, "data", "traces", "runtime", `${sessionId}.jsonl`), options);
  }

  async append(event: Record<string, unknown>): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await this.rotateIfNeeded();
    const line = `${JSON.stringify({ ts: new Date().toISOString(), ...this.defaultMetadata, ...event })}\n`;
    await appendFile(this.filePath, line, "utf-8");
  }

  private async rotateIfNeeded(): Promise<void> {
    let size = 0;
    try {
      size = (await stat(this.filePath)).size;
    } catch {
      return;
    }

    if (size <= this.maxBytes) return;

    const rotatedPath = `${this.filePath}.${Date.now()}`;
    await rename(this.filePath, rotatedPath);

    const dir = dirname(this.filePath);
    const base = basename(this.filePath);
    const entries = await readdir(dir);
    const rotated = entries
      .filter((name) => name.startsWith(`${base}.`))
      .map((name) => resolve(dir, name));

    if (rotated.length <= this.maxFiles) return;

    const withTimes: Array<{ path: string; mtimeMs: number }> = [];
    for (const path of rotated) {
      try {
        const s = await stat(path);
        withTimes.push({ path, mtimeMs: s.mtimeMs });
      } catch {
        // ignore
      }
    }
    withTimes.sort((a, b) => a.mtimeMs - b.mtimeMs);
    const toDelete = withTimes.slice(0, Math.max(0, withTimes.length - this.maxFiles));
    await Promise.allSettled(toDelete.map((e) => unlink(e.path)));
  }
}
