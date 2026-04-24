import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

export interface PeerPromptParts {
  files: Array<{ path: string; content: string }>;
  joined: string;
}

export function loadPeerPromptParts(rootDir: string, peerName: string): PeerPromptParts {
  const peerDir = resolve(rootDir, "peers", peerName);

  let names: string[] = [];
  try {
    names = readdirSync(peerDir);
  } catch {
    return { files: [], joined: "" };
  }

  const mdFiles = names
    .filter((n) => n.toLowerCase().endsWith(".md"))
    .map((n) => resolve(peerDir, n))
    .filter((p) => statSync(p).isFile())
    .sort((a, b) => a.localeCompare(b));

  const files = mdFiles.map((path) => ({ path, content: readFileSync(path, "utf-8").trimEnd() }));
  const joined =
    files.length === 0
      ? ""
      : files
          .map((f) => {
            const relPath = relative(rootDir, f.path) || f.path;
            return `\n\n--- peer:${peerName} file:${relPath} ---\n${f.content}`;
          })
          .join("");

  return { files, joined };
}

