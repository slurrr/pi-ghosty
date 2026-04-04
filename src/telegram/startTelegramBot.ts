import { Telegraf } from "telegraf";
import type { GhostyRuntime } from "../runtime/ghostyRuntime.js";
import type { Env } from "../env.js";

export async function startTelegramBot(env: Env, runtime: GhostyRuntime): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN is required to start Telegram gateway");
  }
  if (!env.TELEGRAM_ALLOWED_USER_ID) {
    throw new Error("TELEGRAM_ALLOWED_USER_ID is required for single-user policy");
  }

  const bot = new Telegraf(env.TELEGRAM_BOT_TOKEN);

  bot.on("text", async (ctx) => {
    const fromId = ctx.from?.id;
    if (fromId !== env.TELEGRAM_ALLOWED_USER_ID) {
      await ctx.reply("Not authorized.");
      return;
    }

    const text = ctx.message.text.trim();
    if (!text) return;

    await ctx.reply("_thinking…_", { parse_mode: "Markdown" });

    const reply = await runtime.handleCoordinatorMessage(text);
    await ctx.reply(reply);
  });

  await bot.launch();
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}
