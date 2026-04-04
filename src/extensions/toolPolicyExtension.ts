import { resolve, relative } from "node:path";
import { isToolCallEventType, type ExtensionFactory, type ToolCallEvent } from "@mariozechner/pi-coding-agent";
import type { GhostyConfig } from "../config/schema.js";
import { JsonlTrace } from "../logging/jsonlTrace.js";

function isPathInsideRoot(rootDir: string, userPath: string): boolean {
  const resolved = resolve(rootDir, userPath);
  const rel = relative(rootDir, resolved);
  return rel !== "" && !rel.startsWith("..") && !rel.startsWith("../");
}

function toolCallSummary(event: ToolCallEvent): Record<string, unknown> {
  if (event.toolName === "bash") {
    return {
      timeout: event.input.timeout ?? null,
      commandLen: typeof event.input.command === "string" ? event.input.command.length : null,
    };
  }
  if (event.toolName === "write") {
    return {
      path: event.input.path,
      contentLen: typeof event.input.content === "string" ? event.input.content.length : null,
    };
  }
  if (event.toolName === "edit") {
    return {
      path: event.input.path,
      edits: Array.isArray(event.input.edits) ? event.input.edits.length : null,
    };
  }
  if ("input" in event) {
    return { inputKeys: Object.keys(event.input ?? {}) };
  }
  return {};
}

export function toolPolicyExtensionFactory(
  config: GhostyConfig,
  agentName: string,
  sessionId: string,
  paths: { projectRoot: string; runDir: string },
): ExtensionFactory {
  const projectTag = config.defaults.projectTag;

  return (pi) => {
    let trace: JsonlTrace | undefined;
    const getTrace = () => (trace ??= JsonlTrace.forAgent(paths.runDir, agentName, sessionId));

    pi.on("tool_call", async (event, ctx) => {
      void ctx;
      const t = getTrace();

      if (isToolCallEventType("bash", event)) {
        const DEFAULT_TIMEOUT_MS = 60_000;
        const MAX_TIMEOUT_MS = 120_000;
        if (typeof event.input.timeout !== "number") {
          event.input.timeout = DEFAULT_TIMEOUT_MS;
        } else if (event.input.timeout > MAX_TIMEOUT_MS) {
          event.input.timeout = MAX_TIMEOUT_MS;
        }
      }

      if (isToolCallEventType("write", event) || isToolCallEventType("edit", event)) {
        if (!isPathInsideRoot(paths.projectRoot, event.input.path)) {
          await t.append({
            type: "tool_policy_block",
            projectTag,
            agentName,
            sessionId,
            toolName: event.toolName,
            toolCallId: event.toolCallId,
            reason: "path_outside_root",
            path: event.input.path,
          });
          return { block: true, reason: "File path must be inside the project root." };
        }
      }

      await t.append({
        type: "tool_call",
        projectTag,
        agentName,
        sessionId,
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        summary: toolCallSummary(event),
      });

      return undefined;
    });

    pi.on("tool_result", async (event, ctx) => {
      void ctx;
      const t = getTrace();
      await t.append({
        type: "tool_result",
        projectTag,
        agentName,
        sessionId,
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        isError: event.isError,
      });
      return undefined;
    });
  };
}
