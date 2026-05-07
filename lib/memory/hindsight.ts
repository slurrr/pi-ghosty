import { HindsightClient } from "@vectorize-io/hindsight-client";

export interface HindsightConfig {
  baseUrl: string;
  bankId: string;
}

export interface RetainMemoryItem {
  content: string;
  timestamp?: string;
  context?: string;
  metadata?: Record<string, string>;
  document_id?: string;
  entities?: Array<{ name: string; entity_type?: string; confidence?: number }>;
  tags?: string[];
  observation_scopes?: "per_tag" | "combined" | "all_combinations" | string[][];
  strategy?: string;
  update_mode?: "replace" | "append";
}

export interface RetainMemoryRequest {
  items: RetainMemoryItem[];
  async?: boolean;
  document_tags?: string[];
}

export interface BankConfigResponse {
  bank_id?: string;
  config?: Record<string, unknown>;
  overrides?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface HindsightServerCapabilities {
  version?: string;
  supportsItemUpdateMode: boolean;
}

export interface OperationStatusResponse {
  operation_id?: string;
  status?: "pending" | "completed" | "failed" | "not_found" | string;
  error_message?: string | null;
  [key: string]: unknown;
}

function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

async function readJson(response: Response): Promise<any> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export function createHindsightClient(cfg: HindsightConfig): HindsightClient {
  return new HindsightClient({ baseUrl: cfg.baseUrl });
}

export function bankMemoriesUrl(baseUrl: string, bankId: string): string {
  return `${trimTrailingSlash(baseUrl)}/v1/default/banks/${encodeURIComponent(bankId)}/memories`;
}

export async function getBankConfigDirect(baseUrl: string, bankId: string): Promise<BankConfigResponse> {
  const url = `${trimTrailingSlash(baseUrl)}/v1/default/banks/${encodeURIComponent(bankId)}/config`;
  const response = await fetch(url, {
    method: "GET",
    headers: { accept: "application/json" },
  });

  const data = await readJson(response);
  if (!response.ok) {
    const error = new Error(`bank config failed (${response.status}): ${JSON.stringify(data)}`);
    (error as any).status = response.status;
    (error as any).details = data;
    throw error;
  }

  return data as BankConfigResponse;
}

export async function getHindsightServerCapabilities(baseUrl: string): Promise<HindsightServerCapabilities> {
  const url = `${trimTrailingSlash(baseUrl)}/openapi.json`;
  const response = await fetch(url, {
    method: "GET",
    headers: { accept: "application/json" },
  });

  const data = await readJson(response);
  if (!response.ok) {
    const error = new Error(`openapi failed (${response.status}): ${JSON.stringify(data)}`);
    (error as any).status = response.status;
    (error as any).details = data;
    throw error;
  }

  const memoryItemProps = (data as any)?.components?.schemas?.MemoryItem?.properties ?? {};
  return {
    version: typeof (data as any)?.info?.version === "string" ? (data as any).info.version : undefined,
    supportsItemUpdateMode: Object.prototype.hasOwnProperty.call(memoryItemProps, "update_mode"),
  };
}

export async function retainMemoriesDirect(baseUrl: string, bankId: string, body: RetainMemoryRequest): Promise<any> {
  const url = bankMemoriesUrl(baseUrl, bankId);
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await readJson(response);
  if (!response.ok) {
    const error = new Error(`retain direct failed (${response.status}): ${JSON.stringify(data)}`);
    (error as any).status = response.status;
    (error as any).details = data;
    throw error;
  }
  return data;
}

export async function getOperationStatusDirect(baseUrl: string, bankId: string, operationId: string): Promise<OperationStatusResponse> {
  const url = `${trimTrailingSlash(baseUrl)}/v1/default/banks/${encodeURIComponent(bankId)}/operations/${encodeURIComponent(operationId)}`;
  const response = await fetch(url, {
    method: "GET",
    headers: { accept: "application/json" },
  });

  const data = await readJson(response);
  if (!response.ok) {
    const error = new Error(`operation status failed (${response.status}): ${JSON.stringify(data)}`);
    (error as any).status = response.status;
    (error as any).details = data;
    throw error;
  }

  return data as OperationStatusResponse;
}
