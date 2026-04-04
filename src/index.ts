import "dotenv/config";
import { loadConfig } from "./config/loadConfig.js";
import { loadEnv } from "./env.js";
import { GhostyRuntime } from "./runtime/ghostyRuntime.js";
import { startTelegramBot } from "./telegram/startTelegramBot.js";

async function main() {
  const rootDir = process.cwd();
  const env = loadEnv();
  const config = loadConfig(rootDir);

  const runtime = await GhostyRuntime.create({
    rootDir,
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
