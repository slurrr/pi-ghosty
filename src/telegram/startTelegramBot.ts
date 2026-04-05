import { Telegraf } from "telegraf";
import type { GhostyRuntime } from "../runtime/ghostyRuntime.js";
import type { Env } from "../env.js";

function splitTelegramMessages(text: string, maxLen = 3800): string[] {
  const out: string[] = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let cut = remaining.lastIndexOf("\n", maxLen);
    if (cut < maxLen * 0.5) cut = maxLen;
    out.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^\n+/, "");
  }
  if (remaining.length) out.push(remaining);
  return out;
}

function formatSystemDump(args: {
  agentName: string;
  sessionId: string;
  sessionState: string;
  tools: string[];
  systemPrompt: string;
}): string {
  const header = [
    `Agent: ${args.agentName}`,
    `Session: ${args.sessionId} (${args.sessionState})`,
    `Tools: ${args.tools.join(", ") || "(none)"}`,
    "",
    "System prompt:",
    args.systemPrompt,
  ].join("\n");

  return header;
}

export async function startTelegramBot(env: Env, runtime: GhostyRuntime): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN is required to start Telegram gateway");
  }
  if (!env.TELEGRAM_ALLOWED_USER_ID) {
    throw new Error("TELEGRAM_ALLOWED_USER_ID is required for single-user policy");
  }

  const bot = new Telegraf(env.TELEGRAM_BOT_TOKEN);

  bot.command("system", async (ctx) => {
    const fromId = ctx.from?.id;
    if (fromId !== env.TELEGRAM_ALLOWED_USER_ID) {
      await ctx.reply("Not authorized.");
      return;
    }

    const raw = ctx.message.text ?? "";
    const args = raw.split(/\s+/).slice(1);
    const target = (args[0] ?? "coordinator").toLowerCase();

    if (target === "coordinator") {
      const coordinator = runtime.getCoordinatorHandle();
      const dump = formatSystemDump({
        agentName: "coordinator",
        sessionId: coordinator.sessionId,
        sessionState: coordinator.sessionState,
        tools: coordinator.session.getActiveToolNames(),
        systemPrompt: coordinator.session.systemPrompt,
      });
      for (const part of splitTelegramMessages(dump)) {
        await ctx.reply(part);
      }
      return;
    }

    const allowedPeers = new Set(["coder", "researcher", "reviewer", "memory"]);
    if (!allowedPeers.has(target)) {
      await ctx.reply('Usage: /system [coordinator|coder|researcher|reviewer|memory]');
      return;
    }

    const peer = await runtime.getPeerSession(target as any);
    const dump = formatSystemDump({
      agentName: target,
      sessionId: peer.sessionId,
      sessionState: peer.sessionState,
      tools: peer.session.getActiveToolNames(),
      systemPrompt: peer.session.systemPrompt,
    });
    for (const part of splitTelegramMessages(dump)) {
      await ctx.reply(part);
    }
  });

  bot.on("text", async (ctx) => {
    const fromId = ctx.from?.id;
    if (fromId !== env.TELEGRAM_ALLOWED_USER_ID) {
      await ctx.reply("Not authorized.");
      return;
    }

    const text = ctx.message.text.trim();
    if (!text) return;

    await ctx.reply("_thinking…_", { parse_mode: "Markdown" });

    const reply = await runtime.handleCoordinatorMessage(text, { streamingBehavior: "followUp" });
    await ctx.reply(reply);
  });

  await bot.launch();
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}
