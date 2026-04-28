import type { ExtensionFactory } from "@mariozechner/pi-coding-agent";
import type { GhostyConfig } from "../config/schema.js";
import { JsonlTrace } from "../logging/jsonlTrace.js";

export function toolGatingExtensionFactory(
  config: GhostyConfig,
  agentName: string,
  extraAllowedTools: string[] = [],
  debug?: { runDir: string; sessionId: string; projectTag: string; traceBlocks?: boolean },
): ExtensionFactory {
  const allowed = new Set([...((config.agents[agentName]?.tools as string[]) ?? []), ...extraAllowedTools]);
  const trace = debug?.traceBlocks ? JsonlTrace.forAgent(debug.runDir, agentName, debug.sessionId) : undefined;

  return (pi) => {
    pi.on("tool_call", async (event) => {
      if (allowed.size === 0) {
        if (trace) {
          await trace.append({
            type: "tool_gating_block",
            projectTag: debug?.projectTag,
            agentName,
            sessionId: debug?.sessionId,
            toolName: event.toolName,
            reason: "no_tools_enabled",
          });
        }
        return { block: true, reason: `No tools enabled for agent "${agentName}"` };
      }
      if (!allowed.has(event.toolName)) {
        if (trace) {
          await trace.append({
            type: "tool_gating_block",
            projectTag: debug?.projectTag,
            agentName,
            sessionId: debug?.sessionId,
            toolName: event.toolName,
            reason: "not_allowed",
          });
        }
        return { block: true, reason: `Tool "${event.toolName}" not allowed for agent "${agentName}"` };
      }
      return undefined;
    });
  };
}
