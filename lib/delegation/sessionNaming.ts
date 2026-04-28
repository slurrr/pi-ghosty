import type { PeerName } from "./sessionCatalogStore.js";

export function formatSessionName(peerName: PeerName, semanticTitle: string, maxLen = 100): string {
  const cleanedTitle = String(semanticTitle ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const title = cleanedTitle || "session";
  const base = `${peerName}: ${title}`;
  return base.slice(0, Math.max(16, maxLen)).trim();
}
