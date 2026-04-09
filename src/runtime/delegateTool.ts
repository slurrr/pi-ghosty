import { Type } from "@sinclair/typebox";
import { defineTool, keyHint } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { delegateRequestSchema, type DelegateRequest, type PeerResult } from "./contracts.js";

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

    renderCall: (args, theme, context) => {
      const peerName = (args as any)?.peerName ?? "?";
      const task = String((args as any)?.task ?? "").trim();
      const taskFirstLine = task.split("\n")[0] ?? "";

      let text = theme.fg("toolTitle", theme.bold("delegate "));
      text += theme.fg("accent", `@${peerName}`);
      if (taskFirstLine) text += theme.fg("muted", " — ") + theme.fg("text", taskFirstLine);

      if (!context.expanded) {
        text += theme.fg("dim", ` (${keyHint("app.tools.expand", "details")})`);
        return new Text(text, 0, 0);
      }

      const ctxText = String((args as any)?.context ?? "");
      const expected = String((args as any)?.expectedOutput ?? "");

      text += "\n" + theme.fg("dim", `task: ${task.length} chars`);
      if (ctxText.trim()) text += "\n" + theme.fg("dim", `context: ${ctxText.trim().length} chars`);
      if (expected.trim()) text += "\n" + theme.fg("dim", `expectedOutput: ${expected.trim().length} chars`);

      // When expanded, show the full envelope (but keep it readable).
      if (task) text += "\n\n" + theme.fg("accent", "Task") + "\n" + theme.fg("text", task);
      if (ctxText.trim()) text += "\n\n" + theme.fg("accent", "Context") + "\n" + theme.fg("text", ctxText.trim());
      if (expected.trim()) text += "\n\n" + theme.fg("accent", "Expected Output") + "\n" + theme.fg("text", expected.trim());

      return new Text(text, 0, 0);
    },

    renderResult: (result, { expanded, isPartial }, theme, _context) => {
      if (isPartial) return new Text(theme.fg("warning", "Delegating..."), 0, 0);

      const details = result.details as PeerResult | undefined;
      if (!details) return new Text(theme.fg("error", "delegate: missing result details"), 0, 0);

      const header = `${details.sessionState} @${details.peerName} (${details.sessionId})`;
      let text = theme.fg("success", header);

      // Always show the peer summary (this is what you integrate).
      text += "\n" + theme.fg("text", details.output.summary);

      if (!expanded) {
        text += theme.fg("dim", ` (${keyHint("app.tools.expand", "details")})`);
        return new Text(text, 0, 0);
      }

      // Expanded view: show structured details if present.
      text += "\n" + theme.fg("dim", `reportSource: ${details.reportSource}`);

      if (Array.isArray(details.output.findings) && details.output.findings.length > 0) {
        text += "\n\n" + theme.fg("accent", "Findings");
        for (const f of details.output.findings) text += "\n" + theme.fg("dim", `- ${f}`);
      }

      if (Array.isArray(details.output.artifacts) && details.output.artifacts.length > 0) {
        text += "\n\n" + theme.fg("accent", "Artifacts");
        for (const a of details.output.artifacts) text += "\n" + theme.fg("dim", `- ${a}`);
      }

      if (Array.isArray(details.output.next_actions) && details.output.next_actions.length > 0) {
        text += "\n\n" + theme.fg("accent", "Next actions");
        for (const n of details.output.next_actions) text += "\n" + theme.fg("dim", `- ${n}`);
      }

      if (details.reportSource === "text" && details.rawText?.trim()) {
        text += "\n\n" + theme.fg("warning", "Raw peer text (peer_report missing)") + "\n" + theme.fg("dim", details.rawText.trim());
      }

      return new Text(text, 0, 0);
    },

    execute: async (_toolCallId, params) => {
      const parsedRequest = delegateRequestSchema.safeParse(params);
      if (!parsedRequest.success) {
        throw new Error(`Invalid delegate request: ${parsedRequest.error.message}`);
      }
      const request = parsedRequest.data;
      const result = await delegate(request);

      return {
        content: [{ type: "text", text: result.output.summary }],
        details: result,
      };
    },
  });
}
