import type { ExtensionFactory } from "@mariozechner/pi-coding-agent";
import type { GhostyConfig, GhostyExtensionConfig, SamplingConfig } from "../config/schema.js";
import { JsonlTrace } from "../logging/jsonlTrace.js";

type GhostySamplingConfig = Pick<GhostyConfig, "defaults" | "agents"> | Pick<GhostyExtensionConfig, "defaults" | "agents">;
type ResolvedSamplingConfig = Partial<SamplingConfig>;
type ExtraBody = Record<string, unknown>;

function resolveSampling(config: GhostySamplingConfig, agentName: string): ResolvedSamplingConfig {
  return {
    ...(config.defaults.sampling ?? {}),
    ...(config.agents[agentName]?.sampling ?? {}),
  };
}

function resolveExtraBody(config: GhostySamplingConfig, agentName: string): ExtraBody | undefined {
  const agent = config.agents[agentName] as any;
  return (agent?.extraBody ?? agent?.extra_body) as ExtraBody | undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(override)) return override;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (k in out) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
}

function applyIfMissing(payload: Record<string, unknown>, key: string, value: unknown) {
  if (value === undefined || value === null) return;
  if (Object.prototype.hasOwnProperty.call(payload, key) && payload[key] !== undefined) return;
  payload[key] = value;
}

function supportsSamplingOverrides(ctx: any): boolean {
  const api = String(ctx?.model?.api || "").trim().toLowerCase();
  const provider = String(ctx?.model?.provider || "").trim().toLowerCase();
  return api === "openai-completions" || provider === "vllm";
}

export function samplingExtensionFactory(
  config: GhostySamplingConfig,
  agentName: string,
  debug: { runDir: string; sessionId: string; projectTag: string; traceSampling?: boolean },
): ExtensionFactory {
  const resolvedSampling = resolveSampling(config, agentName);
  const resolvedExtraBody = resolveExtraBody(config, agentName);
  const hasSampling = Object.keys(resolvedSampling).length > 0;
  const hasExtraBody = !!resolvedExtraBody && Object.keys(resolvedExtraBody).length > 0;
  const trace = debug.traceSampling ? JsonlTrace.forAgent(debug.runDir, agentName, debug.sessionId) : undefined;

  return (pi) => {
    let logged = false;
    let loggedPatch = false;

    pi.on("before_provider_request", async (event, ctx) => {
      if (trace && !logged) {
        logged = true;
        await trace.append({
          type: "sampling_config",
          projectTag: debug.projectTag,
          agentName,
          sessionId: debug.sessionId,
          resolvedSampling,
          resolvedExtraBody,
        });
      }

      if (!hasSampling && !hasExtraBody) return undefined;
      if (!supportsSamplingOverrides(ctx)) return undefined;
      if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) return undefined;

      const payload = { ...(event.payload as Record<string, unknown>) };
      applyIfMissing(payload, "temperature", resolvedSampling.temperature);
      applyIfMissing(payload, "top_p", resolvedSampling.topP);
      applyIfMissing(payload, "top_k", resolvedSampling.topK);
      applyIfMissing(payload, "min_p", resolvedSampling.minP);
      applyIfMissing(payload, "repetition_penalty", resolvedSampling.repetitionPenalty);
      applyIfMissing(payload, "presence_penalty", resolvedSampling.presencePenalty);
      applyIfMissing(payload, "frequency_penalty", resolvedSampling.frequencyPenalty);

      if (hasExtraBody) {
        // vLLM/OpenAI-compat expects these fields at the top-level request body.
        // (OpenAI client libraries use an `extra_body` *argument* that is merged into the body,
        // not an `extra_body` JSON field sent over the wire.)
        const merged = deepMerge(payload, resolvedExtraBody);
        // deepMerge returns unknown; we know we're merging plain objects here.
        Object.assign(payload, merged as Record<string, unknown>);
      }

      if (trace && !loggedPatch) {
        loggedPatch = true;
        await trace.append({
          type: "provider_request_patch",
          projectTag: debug.projectTag,
          agentName,
          sessionId: debug.sessionId,
          payloadKeys: Object.keys(payload).sort(),
          applied: {
            sampling: hasSampling,
            extraBody: hasExtraBody,
          },
          extraBody: hasExtraBody ? resolvedExtraBody : undefined,
        });
      }

      return payload;
    });
  };
}
