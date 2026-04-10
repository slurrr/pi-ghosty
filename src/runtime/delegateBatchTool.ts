import { Type } from "@sinclair/typebox";
import { defineTool, keyHint } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { delegateBatchRequestSchema, type DelegateBatchRequest, type PeerResult } from "./contracts.js";

export type DelegateBatchHandler = (request: DelegateBatchRequest) => Promise<PeerResult[]>;

export function createDelegateBatchTool(delegateBatch: DelegateBatchHandler) {
  return defineTool({
    name: "delegate_batch",
    label: "Delegate Batch",
    description: "Delegate multiple requests to specialist peers with bounded concurrency.",
    parameters: Type.Object({
      requests: Type.Array(
        Type.Object({
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
        { minItems: 1 },
      ),
    }),

    renderCall: (args, theme, context) => {
      const requests = Array.isArray((args as any)?.requests) ? ((args as any).requests as any[]) : [];
      let text = theme.fg("toolTitle", theme.bold("delegate_batch "));
      text += theme.fg("accent", `${requests.length} request${requests.length === 1 ? "" : "s"}`);

      if (!context.expanded) {
        text += theme.fg("dim", ` (${keyHint("app.tools.expand", "details")})`);
        return new Text(text, 0, 0);
      }

      for (const [i, r] of requests.entries()) {
        const peer = String(r?.peerName ?? "?");
        const task = String(r?.task ?? "").trim().split("\n")[0] ?? "";
        text += `\n${theme.fg("dim", `${i + 1}.`)} ${theme.fg("accent", `@${peer}`)} ${theme.fg("text", task)}`;
      }

      return new Text(text, 0, 0);
    },

    renderResult: (result, { expanded, isPartial }, theme) => {
      if (isPartial) return new Text(theme.fg("warning", "Delegating batch..."), 0, 0);
      const details = result.details as PeerResult[] | undefined;
      if (!details) return new Text(theme.fg("error", "delegate_batch: missing result details"), 0, 0);

      let text = theme.fg("success", `Completed ${details.length} delegation${details.length === 1 ? "" : "s"}`);
      for (const r of details) {
        text += `\n${theme.fg("accent", `@${r.peerName}`)} ${theme.fg("dim", `(${r.sessionId})`)}: ${theme.fg("text", r.output.summary)}`;
      }

      if (!expanded) {
        text += theme.fg("dim", ` (${keyHint("app.tools.expand", "details")})`);
      }
      return new Text(text, 0, 0);
    },

    execute: async (_toolCallId, params) => {
      const parsed = delegateBatchRequestSchema.safeParse(params);
      if (!parsed.success) {
        throw new Error(`Invalid delegate_batch request: ${parsed.error.message}`);
      }
      const result = await delegateBatch(parsed.data);
      const summary = result.map((r) => `@${r.peerName}: ${r.output.summary}`).join("\n");
      return {
        content: [{ type: "text", text: summary || "ok" }],
        details: result,
      };
    },
  });
}
