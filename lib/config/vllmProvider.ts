import { createHash } from "node:crypto";
import type { GhostyConfig } from "./schema.js";

export interface VllmModelInfo {
  id: string;
  name?: string;
  allIds: string[];
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function sha1(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

const discoveryCache = new Map<string, Promise<VllmModelInfo>>();

export async function discoverVllmDefaultModel(baseUrl: string): Promise<VllmModelInfo> {
  const key = sha1(baseUrl);
  const cached = discoveryCache.get(key);
  if (cached) return cached;

  const p = (async () => {
    const url = `${normalizeBaseUrl(baseUrl)}/models`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
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

    const allIds = [...new Set(ids)];
    const chosen = allIds[0];
    return { id: chosen, name: chosen, allIds } satisfies VllmModelInfo;
  })();

  discoveryCache.set(key, p);
  return p;
}

export async function registerVllmProvider(modelRegistry: any, config: GhostyConfig, baseUrlOverride?: string): Promise<VllmModelInfo | null> {
  if (!modelRegistry || typeof modelRegistry.registerProvider !== "function") return null;

  const baseUrl = baseUrlOverride || process.env.VLLM_BASE_URL || config.defaults.runtime?.vllmBaseUrl;
  if (!baseUrl) return null;

  const vllmModel = await discoverVllmDefaultModel(baseUrl);

  modelRegistry.registerProvider("vllm", {
    api: "openai-completions",
    baseUrl,
    apiKey: "dummy",
    authHeader: false,
    models: [
      {
        id: vllmModel.id,
        name: `${vllmModel.id} (vLLM)`,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: config.defaults.runtime!.model.contextWindow,
        maxTokens: config.defaults.runtime!.model.maxTokens,
      },
    ],
  } as any);

  return vllmModel;
}
