import type { ExtensionFactory } from "@mariozechner/pi-coding-agent";
import type { GhostyConfig, SamplingConfig } from "../config/schema.js";
import { resolveRequestRuleApply } from "../config/rules.js";
import { JsonlTrace } from "../logging/jsonlTrace.js";

type ResolvedSamplingConfig = Partial<SamplingConfig>;
type ExtraBody = Record<string, unknown>;

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

export function samplingExtensionFactory(
  config: GhostyConfig,
  agentName: string,
  debug: { runDir: string; sessionId: string; projectTag: string; traceSampling?: boolean },
): ExtensionFactory {
  const trace = debug.traceSampling ? JsonlTrace.forAgent(debug.runDir, agentName, debug.sessionId) : undefined;

  return (pi) => {
    let logged = false;
    let loggedPatch = false;
    let requestSeq = 0;

    pi.on("before_provider_request", async (event, ctx) => {
      const model = ctx?.model ? { provider: ctx.model.provider, id: ctx.model.id } : null;
      const resolved = resolveRequestRuleApply(config, agentName, model);
      const resolvedSampling = (resolved.sampling ?? {}) as ResolvedSamplingConfig;
      const resolvedExtraBody = (resolved.extraBody ?? resolved.extra_body) as ExtraBody | undefined;
      const hasSampling = Object.keys(resolvedSampling).length > 0;
      const hasExtraBody = !!resolvedExtraBody && Object.keys(resolvedExtraBody).length > 0;

      if (trace && !logged) {
        logged = true;
        await trace.append({
          type: "sampling_config",
          projectTag: debug.projectTag,
          agentName,
          sessionId: debug.sessionId,
          model,
          resolvedSampling,
          resolvedExtraBody,
        });
      }

      if (trace) {
        requestSeq += 1;
        await trace.append({
          type: "sampling_request",
          projectTag: debug.projectTag,
          agentName,
          sessionId: debug.sessionId,
          seq: requestSeq,
          model,
        });
      }

      if (!hasSampling && !hasExtraBody) return undefined;
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
        const merged = deepMerge(payload, resolvedExtraBody);
        Object.assign(payload, merged as Record<string, unknown>);
      }

      if (trace && !loggedPatch) {
        loggedPatch = true;
        await trace.append({
          type: "provider_request_patch",
          projectTag: debug.projectTag,
          agentName,
          sessionId: debug.sessionId,
          model,
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
