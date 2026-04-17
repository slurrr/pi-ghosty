import "dotenv/config";
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config/loadConfig.js";
import { loadEnv, resolveRunDir, resolveWorkDir } from "./env.js";
import { GhostyRuntime } from "./runtime/ghostyRuntime.js";
import { startTui } from "./tui/startTui.js";

function writePidFile(runDir: string): string {
  mkdirSync(runDir, { recursive: true });
  const pidPath = resolve(runDir, "ghosty.pid");
  writeFileSync(pidPath, `${process.pid}\n`, "utf-8");
  return pidPath;
}

function resolveProjectDir(envProjectDir: string | undefined): string {
  const configured = envProjectDir?.trim();
  if (configured) return resolve(process.cwd(), configured);
  const here = dirname(fileURLToPath(import.meta.url));
  // src/index.ts -> <repo>/src OR dist/index.js -> <repo>/dist
  return resolve(here, "..");
}

async function main() {
  // projectDir = where ghosty code + prompts + config live
  // workDir = sandbox root (where tools are allowed to operate)
  const env = loadEnv();
  const projectDir = resolveProjectDir(env.GHOSTY_PROJECT_DIR);
  const workDir = resolveWorkDir(env, process.cwd(), projectDir);

  const config = loadConfig(projectDir);
  const runDir = resolveRunDir(env);

  const pidPath = writePidFile(runDir);
  const cleanup = () => {
    try {
      unlinkSync(pidPath);
    } catch {
      // ignore
    }
  };
  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(143);
  });

  const runtime = await GhostyRuntime.create({
    projectDir,
    workDir,
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
