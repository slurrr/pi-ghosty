import "dotenv/config";
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { loadConfig } from "./config/loadConfig.js";
import { loadEnv, resolveRunDir } from "./env.js";
import { GhostyRuntime } from "./runtime/ghostyRuntime.js";
import { startTui } from "./tui/startTui.js";

function writePidFile(runDir: string): string {
  mkdirSync(runDir, { recursive: true });
  const pidPath = resolve(runDir, "ghosty.pid");
  writeFileSync(pidPath, `${process.pid}\n`, "utf-8");
  return pidPath;
}

async function main() {
  // projectDir = where ghosty code + prompts + config live
  // workDir = sandbox root (where tools are allowed to operate)
  const projectDir = resolve(homedir(), "code", "dev", "pi-ghosty");
  const workDir = process.cwd();

  const env = loadEnv();
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
