import { Type } from "@sinclair/typebox";
import { defineTool } from "@mariozechner/pi-coding-agent";
import { peerOutputSchema, type PeerOutput } from "./contracts.js";

export function createPeerReportTool() {
  return defineTool({
    name: "peer_report",
    label: "Peer Report",
    description: "Report a structured peer result to the coordinator runtime.",
    parameters: Type.Object({
      summary: Type.String({ minLength: 1 }),
      findings: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
      artifacts: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
      next_actions: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    }),
    execute: async (_toolCallId, params) => {
      const output = peerOutputSchema.parse(params) as PeerOutput;
      return {
        content: [{ type: "text", text: "ok" }],
        details: output,
      };
    },
  });
}

