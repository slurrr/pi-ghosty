import { Type } from "@sinclair/typebox";
import { defineTool } from "@mariozechner/pi-coding-agent";
import type { DelegateRequest, PeerResult } from "./contracts.js";

export type DelegateHandler = (request: DelegateRequest) => Promise<PeerResult>;

export function createDelegateTool(delegate: DelegateHandler) {
  return defineTool({
    name: "delegate",
    label: "Delegate Task",
    description: "Delegate work to a specialist peer and return its result.",
    parameters: Type.Object({
      peerName: Type.Union([
        Type.Literal("coder"),
        Type.Literal("researcher"),
        Type.Literal("reviewer"),
        Type.Literal("memory"),
      ]),
      task: Type.String({ minLength: 1 }),
      context: Type.Optional(Type.String()),
      expectedOutput: Type.Optional(Type.String()),
    }),
    execute: async (_toolCallId, params) => {
      const request = params as DelegateRequest;
      const result = await delegate(request);
      return {
        content: [{ type: "text", text: result.summary }],
        details: result,
      };
    },
  });
}
