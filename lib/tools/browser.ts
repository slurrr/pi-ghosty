import { spawnSync } from "node:child_process";
import { Type } from "@sinclair/typebox";
import { defineTool } from "@mariozechner/pi-coding-agent";
import { JsonlTrace } from "../logging/jsonlTrace.js";

function runBbBrowser(args: string[]): { ok: true; output: string } | { ok: false; error: string } {
  const res = spawnSync("bb-browser", args, { encoding: "utf8" });
  if (res.error) {
    return { ok: false, error: res.error.message || String(res.error) };
  }
  const output = `${res.stdout || ""}${res.stderr || ""}`.trim();
  if (res.status !== 0) {
    return { ok: false, error: output || `bb-browser exited with ${res.status}` };
  }
  return { ok: true, output };
}

export function registerBrowserTools(pi: any, args: { runDir: string }) {
  const { runDir } = args;

  pi.registerTool(
    defineTool({
      name: "browser_open",
      label: "Browser Open",
      description: "Open a URL in bb-browser. Use this instead of shelling out via bash.",
      parameters: Type.Object({
        url: Type.String({ minLength: 1 }),
      }),
      execute: async (_toolCallId, params) => {
        const url = String((params as any)?.url ?? "").trim();
        if (!url) throw new Error("browser_open requires a non-empty url");

        const result = runBbBrowser(["open", url]);
        if (!result.ok) throw new Error(`browser_open failed: ${result.error}`);

        return {
          content: [{ type: "text", text: result.output || `opened ${url}` }],
          details: { ok: true, url, output: result.output },
        };
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: "browser_snapshot",
      label: "Browser Snapshot",
      description:
        "Capture page snapshot via bb-browser. Optional selector narrows capture; if selector fails, tool traces and falls back to full snapshot.",
      parameters: Type.Object({
        selector: Type.Optional(Type.String({ minLength: 1 })),
      }),
      execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
        const selector = String((params as any)?.selector ?? "").trim();

        if (selector) {
          const scoped = runBbBrowser(["snapshot", "--selector", selector]);
          if (scoped.ok) {
            return {
              content: [{ type: "text", text: scoped.output || "(empty snapshot)" }],
              details: { ok: true, selector, fallback: false, output: scoped.output },
            };
          }

          try {
            const sessionId = String(ctx?.sessionManager?.getSessionId?.() ?? "unknown");
            const trace = JsonlTrace.forRuntime(runDir, sessionId);
            await trace.append({
              type: "browser_selector_failure",
              selector,
              error: scoped.error,
            });
          } catch {
            // best-effort tracing only
          }

          const fallback = runBbBrowser(["snapshot"]);
          if (!fallback.ok) {
            throw new Error(`browser_snapshot fallback failed: ${fallback.error}`);
          }
          return {
            content: [{ type: "text", text: fallback.output || "(empty snapshot)" }],
            details: { ok: true, selector, fallback: true, selectorError: scoped.error, output: fallback.output },
          };
        }

        const result = runBbBrowser(["snapshot"]);
        if (!result.ok) throw new Error(`browser_snapshot failed: ${result.error}`);

        return {
          content: [{ type: "text", text: result.output || "(empty snapshot)" }],
          details: { ok: true, fallback: false, output: result.output },
        };
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: "browser_eval",
      label: "Browser Eval",
      description: "Run JavaScript in bb-browser context. High privilege; gate to trusted agents only.",
      parameters: Type.Object({
        script: Type.String({ minLength: 1 }),
      }),
      execute: async (_toolCallId, params) => {
        const script = String((params as any)?.script ?? "");
        if (!script.trim()) throw new Error("browser_eval requires a non-empty script");

        const result = runBbBrowser(["eval", script]);
        if (!result.ok) throw new Error(`browser_eval failed: ${result.error}`);

        return {
          content: [{ type: "text", text: result.output || "(empty eval output)" }],
          details: { ok: true, output: result.output },
        };
      },
    }),
  );
}
