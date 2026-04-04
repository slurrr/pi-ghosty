import "dotenv/config";
import { loadConfig } from "./config/loadConfig.js";
import { loadEnv, resolveRunDir } from "./env.js";
import { GhostyRuntime } from "./runtime/ghostyRuntime.js";
import { startTelegramBot } from "./telegram/startTelegramBot.js";

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

  // v1: bring up Telegram gateway and route all IO through coordinator.
  await startTelegramBot(env, runtime);

  console.log("pi-ghosty telegram gateway started");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
