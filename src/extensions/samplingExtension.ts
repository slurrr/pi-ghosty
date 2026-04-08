import type { ExtensionFactory } from "@mariozechner/pi-coding-agent";
import type { GhostyConfig } from "../config/schema.js";
import { JsonlTrace } from "../logging/jsonlTrace.js";

type SamplingConfig = NonNullable<GhostyConfig["defaults"]["sampling"]>;

function resolveSampling(config: GhostyConfig, agentName: string): SamplingConfig {
  return {
    ...(config.defaults.sampling ?? {}),
    ...(config.agents[agentName]?.sampling ?? {}),
  };
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
  const resolvedSampling = resolveSampling(config, agentName);
  const hasSampling = Object.keys(resolvedSampling).length > 0;
  const trace = debug.traceSampling ? JsonlTrace.forAgent(debug.runDir, agentName, debug.sessionId) : undefined;

  return (pi) => {
    let logged = false;

    pi.on("before_provider_request", async (event) => {
      if (trace && !logged) {
        logged = true;
        await trace.append({
          type: "sampling_config",
          projectTag: debug.projectTag,
          agentName,
          sessionId: debug.sessionId,
          resolvedSampling,
        });
      }

      if (!hasSampling) return undefined;
      if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) return undefined;

      const payload = { ...(event.payload as Record<string, unknown>) };
      applyIfMissing(payload, "temperature", resolvedSampling.temperature);
      applyIfMissing(payload, "top_p", resolvedSampling.topP);
      applyIfMissing(payload, "top_k", resolvedSampling.topK);
      applyIfMissing(payload, "min_p", resolvedSampling.minP);
      applyIfMissing(payload, "repetition_penalty", resolvedSampling.repetitionPenalty);
      applyIfMissing(payload, "presence_penalty", resolvedSampling.presencePenalty);
      applyIfMissing(payload, "frequency_penalty", resolvedSampling.frequencyPenalty);
      return payload;
    });
  };
}
