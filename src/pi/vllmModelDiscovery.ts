import { createHash } from "node:crypto";

export interface VllmModelInfo {
  /** Chosen default model id */
  id: string;
  /** Optional server-provided label (may equal id) */
  name?: string;
  /** All model ids returned by /v1/models (best-effort) */
  allIds: string[];
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function sha1(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

// Cache: baseUrl -> discovery promise (dedupe concurrent calls)
const discoveryCache = new Map<string, Promise<VllmModelInfo>>();

/**
 * Discover available vLLM models via the OpenAI-compatible GET /models endpoint.
 *
 * baseUrl is expected to already include /v1 (pi-ghosty default is http://localhost:8002/v1).
 */
export async function discoverVllmDefaultModel(baseUrl: string): Promise<VllmModelInfo> {
  const key = sha1(baseUrl);
  const cached = discoveryCache.get(key);
  if (cached) return cached;

  const p = (async () => {
    const url = `${normalizeBaseUrl(baseUrl)}/models`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        // vLLM ignores auth by default, but some proxies require a header.
        Authorization: "Bearer dummy",
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`vLLM model discovery failed: GET ${url} -> ${res.status} ${res.statusText}${text ? `\n${text}` : ""}`);
    }

    const json = (await res.json()) as any;
    const data: any[] = Array.isArray(json?.data) ? json.data : [];
    const ids = data.map((m) => String(m?.id ?? "").trim()).filter(Boolean);

    if (ids.length === 0) {
      throw new Error(`vLLM model discovery returned no models from ${url}`);
    }

    // Choose a stable default.
    // If multiple are present (e.g., LoRAs), prefer server ordering (data[0]).
    // Rationale: no config required; vLLM/proxies typically place the primary/default model first.
    const allIds = [...new Set(ids)];
    const chosen = allIds[0];

    return {
      id: chosen,
      name: chosen,
      allIds,
    } satisfies VllmModelInfo;
  })();

  discoveryCache.set(key, p);
  return p;
}
