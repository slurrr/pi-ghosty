import "dotenv/config";
import { loadConfig } from "./config/loadConfig.js";
import { loadEnv, resolveRunDir } from "./env.js";
import { GhostyRuntime } from "./runtime/ghostyRuntime.js";
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

  await startTui(runtime);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
