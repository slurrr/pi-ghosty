import { mkdir, appendFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export interface ArtifactRecord {
  ts: string;
  projectTag: string;
  peerName: string;
  kind: string;
  text: string;
}

export class ArtifactStore {
  constructor(private readonly filePath: string) {}

  static forProject(runDir: string, projectTag: string): ArtifactStore {
    const safeProject = projectTag.replace(/[^a-zA-Z0-9:_-]/g, "_");
    return new ArtifactStore(resolve(runDir, "data", "artifacts", `${safeProject}.jsonl`));
  }

  async append(record: Omit<ArtifactRecord, "ts">): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const line = `${JSON.stringify({ ts: new Date().toISOString(), ...record })}\n`;
    await appendFile(this.filePath, line, "utf-8");
  }
}
