import type { ExtensionFactory } from "@mariozechner/pi-coding-agent";
import type { GhostyConfig } from "../config/schema.js";

export function toolGatingExtensionFactory(config: GhostyConfig, agentName: string): ExtensionFactory {
  const allowed = new Set(config.agents[agentName]?.tools ?? []);

  return (pi) => {
    pi.on("tool_call", (event) => {
      if (allowed.size === 0) {
        return { block: true, reason: `No tools enabled for agent "${agentName}"` };
      }
      if (!allowed.has(event.toolName)) {
        return { block: true, reason: `Tool "${event.toolName}" not allowed for agent "${agentName}"` };
      }
      return undefined;
    });
  };
}

