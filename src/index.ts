import "dotenv/config";
import { loadConfig } from "./config/loadConfig.js";
import { loadEnv, resolveRunDir } from "./env.js";
import { GhostyRuntime } from "./runtime/ghostyRuntime.js";
import { startTelegramBot } from "./telegram/startTelegramBot.js";
import { startTui } from "./tui/startTui.js";

async function main() {
  const rootDir = process.cwd();
  const env = loadEnv();
  const config = loadConfig(rootDir);
  const runDir = resolveRunDir(env);

  const runtime = await GhostyRuntime.create({
    rootDir,
    runDir,
    env,
    config,
  });

  if (env.GHOSTY_INTERFACE === "telegram") {
    await startTelegramBot(env, runtime);
    console.log("pi-ghosty telegram gateway started");
    return;
  }

  if (env.GHOSTY_INTERFACE === "both") {
    await startTelegramBot(env, runtime);
    console.log("pi-ghosty telegram gateway started");
  }

  await startTui(runtime);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
