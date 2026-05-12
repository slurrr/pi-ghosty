import { Type } from "@sinclair/typebox";
import { defineTool } from "@mariozechner/pi-coding-agent";
import { peerOutputSchema, type PeerOutput } from "./contracts.js";

export function createPeerReportTool(onReport?: (output: PeerOutput) => Promise<void> | void) {
  return defineTool({
    name: "peer_report",
    label: "Peer Report",
    description: "Report a structured peer result to the corroborator runtime.",
    parameters: Type.Object({
      summary: Type.String({ minLength: 1 }),
      findings: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
      artifacts: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
      next_actions: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    }),
    execute: async (_toolCallId, params) => {
      const output = peerOutputSchema.parse(params) as PeerOutput;
      try {
        await onReport?.(output);
      } catch {
        // The peer report is durable even if the corroborator notification fails.
      }
      return {
        content: [{ type: "text", text: "ok" }],
        details: output,
      };
    },
  });
}

