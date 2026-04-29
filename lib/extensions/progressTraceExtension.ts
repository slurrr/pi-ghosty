import { isToolCallEventType, type ExtensionFactory, type ToolCallEvent } from "@mariozechner/pi-coding-agent";
import { JsonlTrace } from "../logging/jsonlTrace.js";

function toolCallSummary(event: ToolCallEvent): Record<string, unknown> {
  if (isToolCallEventType("bash", event)) {
    return {
      timeout: event.input.timeout ?? null,
      commandLen: typeof event.input.command === "string" ? event.input.command.length : null,
      commandPreview: typeof event.input.command === "string" ? event.input.command.slice(0, 160) : null,
    };
  }
  if (isToolCallEventType("write", event)) {
    return {
      path: event.input.path,
      contentLen: typeof event.input.content === "string" ? event.input.content.length : null,
    };
  }
  if (isToolCallEventType("edit", event)) {
    return {
      path: event.input.path,
      edits: Array.isArray(event.input.edits) ? event.input.edits.length : null,
    };
  }
  return {
    inputKeys: event.input && typeof event.input === "object" ? Object.keys(event.input as Record<string, unknown>) : [],
  };
}

export function progressTraceExtensionFactory(options: {
  runDir: string;
  projectTag: string;
  agentName: string;
  sessionId: string;
}): ExtensionFactory {
  const trace = JsonlTrace.forAgent(options.runDir, options.agentName, options.sessionId);

  return (pi) => {
    let providerRequestSeq = 0;
    const toolStartMs = new Map<string, number>();

    pi.on("agent_start", async () => {
      await trace.append({
        type: "agent_turn_start",
        projectTag: options.projectTag,
        agentName: options.agentName,
        sessionId: options.sessionId,
      });
    });

    pi.on("before_provider_request", async (_event, ctx) => {
      providerRequestSeq += 1;
      await trace.append({
        type: "provider_request",
        projectTag: options.projectTag,
        agentName: options.agentName,
        sessionId: options.sessionId,
        seq: providerRequestSeq,
        model: ctx?.model ? { provider: ctx.model.provider, id: ctx.model.id } : null,
      });
      return undefined;
    });

    pi.on("tool_call", async (event) => {
      toolStartMs.set(event.toolCallId, Date.now());
      await trace.append({
        type: "tool_call",
        projectTag: options.projectTag,
        agentName: options.agentName,
        sessionId: options.sessionId,
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        summary: toolCallSummary(event),
      });
      return undefined;
    });

    pi.on("tool_execution_end", async (event) => {
      const startedAt = toolStartMs.get(event.toolCallId);
      if (startedAt) toolStartMs.delete(event.toolCallId);
      await trace.append({
        type: "tool_end",
        projectTag: options.projectTag,
        agentName: options.agentName,
        sessionId: options.sessionId,
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        isError: event.isError,
        elapsedMs: startedAt ? Math.max(0, Date.now() - startedAt) : null,
      });
    });
  };
}
