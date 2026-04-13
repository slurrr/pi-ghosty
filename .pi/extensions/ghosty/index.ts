import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SessionManager,
  createAgentSessionFromServices,
  createAgentSessionServices,
  defineTool,
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { loadConfig } from "../../../src/config/loadConfig.js";
import { loadPeerPromptParts } from "../../../src/prompts/loadPeerPromptParts.js";
import {
  buildPeerDelegationPrompt,
  delegateRequestSchema,
  ghostyPeerNames,
  peerOutputSchema,
} from "../../../src/runtime/contracts.js";
import { createPeerReportTool } from "../../../src/runtime/peerReportTool.js";

function getProjectDirFromImportMetaUrl(metaUrl: string): string {
  const extensionDir = dirname(fileURLToPath(metaUrl));
  // <repo>/.pi/extensions/ghosty
  return resolve(extensionDir, "..", "..", "..");
}

function lastAssistantText(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== "assistant") continue;
    const content = message?.content;
    if (typeof content === "string" && content.trim()) return content;
    if (Array.isArray(content)) {
      const text = content
        .filter((block: any) => block?.type === "text" && typeof block?.text === "string")
        .map((block: any) => block.text)
        .join("");
      if (text.trim()) return text;
    }
  }
  return "(no assistant text)";
}

function hasPersistedPeerSessions(peerSessionDir: string): boolean {
  try {
    return readdirSync(peerSessionDir).some((name) => name.endsWith(".jsonl"));
  } catch {
    return false;
  }
}

function shellQuote(value: string): string {
  // Minimal POSIX shell quoting suitable for passing a single command string to tmux.
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export default function (pi: any) {
  const projectDir = getProjectDirFromImportMetaUrl(import.meta.url);
  const config = loadConfig(projectDir);
  const runDir = process.env.GHOSTY_PI_RUN_DIR?.trim() || resolve(homedir(), "runs", "pi-ghosty-pi");

  async function delegateOnce(request: any, ctx: any) {
    if (!ctx.model) {
      throw new Error("No model selected. Use /model to choose one, or /login if provider auth is required.");
    }

    const parsed = delegateRequestSchema.parse(request);

    const peerSessionDir = resolve(runDir, "data", "sessions", parsed.peerName);
    mkdirSync(peerSessionDir, { recursive: true });

    const hadExisting = hasPersistedPeerSessions(peerSessionDir);
    const peerSessionManager = SessionManager.continueRecent(ctx.cwd, peerSessionDir);
    const sessionState: "new" | "resumed" = hadExisting ? "resumed" : "new";
    const peerSessionId = peerSessionManager.getSessionId();

    const peerParts = loadPeerPromptParts(projectDir, parsed.peerName);
    const services = await createAgentSessionServices({
      cwd: ctx.cwd,
      resourceLoaderOptions: {
        appendSystemPrompt: resolve(projectDir, ".pi", "APPEND_SYSTEM.md"),
        additionalSkillPaths: [resolve(projectDir, ".pi", "skills")],
        appendSystemPromptOverride: (base) => {
          const out = [...base];
          if (peerParts.joined.trim()) out.push(peerParts.joined);
          return out;
        },
      },
    });

    const { session } = await createAgentSessionFromServices({
      services,
      sessionManager: peerSessionManager,
      model: ctx.model,
      customTools: [createPeerReportTool()],
    });

    const prompt = buildPeerDelegationPrompt(parsed, {
      projectTag: config.defaults.projectTag,
      coordinatorSessionId: ctx.sessionManager.getSessionId(),
      peerSessionId,
      sessionState,
    });

    const before = session.messages.length;
    await session.prompt(prompt, { source: "extension" });

    const newMessages: any[] = session.messages.slice(before);
    let output: any | undefined;
    for (let i = newMessages.length - 1; i >= 0; i--) {
      const m = newMessages[i];
      if (m?.role !== "toolResult" || m?.toolName !== "peer_report") continue;
      const parsedOutput = peerOutputSchema.safeParse(m?.details);
      if (parsedOutput.success) {
        output = parsedOutput.data;
        break;
      }
    }

    if (!output) {
      output = { summary: lastAssistantText(session.messages) };
    }

    return {
      peerName: parsed.peerName,
      sessionId: peerSessionId,
      sessionState,
      output,
    };
  }

  pi.registerCommand("ghosty", {
    description: "Ghosty extension utilities. Subcommands: status, smoke",
    handler: async (args: string, ctx: any) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const subcommand = (parts[0] || "status").toLowerCase();

      if (subcommand === "status") {
        const lines = [
          "ghosty status",
          `runDir: ${runDir}`,
          `projectTag: ${config.defaults.projectTag}`,
          "peer session dirs:",
        ];

        for (const peerName of ghostyPeerNames) {
          const peerDir = resolve(runDir, "data", "sessions", peerName);
          const exists = existsSync(peerDir) && statSync(peerDir).isDirectory();
          lines.push(`- ${peerName}: ${peerDir}${exists ? "" : " (missing)"}`);
        }

        const text = lines.join("\n");
        if (ctx.hasUI) ctx.ui.notify(text, "info");
        else process.stdout.write(`${text}\n`);
        return;
      }

      if (subcommand === "smoke") {
        const result = await delegateOnce(
          {
            peerName: "researcher",
            task: "Call peer_report with summary exactly: smoke test ok",
            expectedOutput: "A peer_report response with summary exactly: smoke test ok",
          },
          ctx,
        );

        const text = `ghosty smoke: ${result.output.summary}`;
        if (ctx.hasUI) ctx.ui.notify(text, "info");
        else process.stdout.write(`${text}\n`);
        return;
      }

      const msg = `Unknown subcommand: ${subcommand}. Try: /ghosty status or /ghosty smoke`;
      if (ctx.hasUI) ctx.ui.notify(msg, "warning");
      else process.stdout.write(`${msg}\n`);
    },
  });

  pi.registerCommand("peer", {
    description: "Peer utilities. Subcommands: open <peer>",
    handler: async (args: string, ctx: any) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const subcommand = (parts[0] || "open").toLowerCase();

      if (subcommand !== "open") {
        const msg = `Unknown subcommand: ${subcommand}. Try: /peer open <peer>`;
        if (ctx.hasUI) ctx.ui.notify(msg, "warning");
        else process.stdout.write(`${msg}\n`);
        return;
      }

      const peerName = parts[1];
      if (!peerName || !ghostyPeerNames.includes(peerName as any)) {
        const msg = `Usage: /peer open <peer> (one of: ${ghostyPeerNames.join(", ")})`;
        if (ctx.hasUI) ctx.ui.notify(msg, "warning");
        else process.stdout.write(`${msg}\n`);
        return;
      }

      if (!process.env.TMUX) {
        const msg = "Not running inside tmux (TMUX env var not set). Start pi from tmux to use /peer open.";
        if (ctx.hasUI) ctx.ui.notify(msg, "warning");
        else process.stdout.write(`${msg}\n`);
        return;
      }

      const peerSessionDir = resolve(runDir, "data", "sessions", peerName);
      mkdirSync(peerSessionDir, { recursive: true });

      const sessions = await SessionManager.list(ctx.cwd, peerSessionDir);
      if (sessions.length === 0) {
        const msg = `No peer sessions found for ${peerName}. Delegate once first.`;
        if (ctx.hasUI) ctx.ui.notify(msg, "warning");
        else process.stdout.write(`${msg}\n`);
        return;
      }

      const mostRecent = [...sessions].sort((a: any, b: any) => +b.modified - +a.modified)[0];
      const sessionPath = mostRecent.path;

      // Open a new tmux window running pi on the peer session.
      // We pass -e <this extension> so the same tools/commands are available.
      const extPath = fileURLToPath(import.meta.url);
      const cmd =
        `GHOSTY_PI_RUN_DIR=${shellQuote(runDir)} ` +
        `pi --session ${shellQuote(sessionPath)} --session-dir ${shellQuote(peerSessionDir)} -e ${shellQuote(extPath)}`;

      const res = spawnSync("tmux", ["new-window", "-n", peerName, cmd], {
        encoding: "utf8",
      });

      if (res.status !== 0) {
        const msg = `tmux new-window failed (exit ${res.status}): ${(res.stderr || res.stdout || "").trim()}`;
        if (ctx.hasUI) ctx.ui.notify(msg, "error");
        else process.stdout.write(`${msg}\n`);
        return;
      }

      const ok = `Opened tmux window for ${peerName} (${sessionPath})`;
      if (ctx.hasUI) ctx.ui.notify(ok, "info");
      else process.stdout.write(`${ok}\n`);
    },
  });

  pi.registerTool(
    defineTool({
      name: "delegate",
      label: "Delegate Task",
      description: "Delegate work to a specialist peer and return a structured summary.",
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
      execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
        const result = await delegateOnce(params, ctx);
        return {
          content: [{ type: "text", text: result.output.summary }],
          details: result,
        };
      },
    }),
  );
}
