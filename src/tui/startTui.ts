import {
  AgentSessionRuntime,
  InteractiveMode,
  type CreateAgentSessionRuntimeFactory,
} from "@mariozechner/pi-coding-agent";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config/loadConfig.js";
import { loadEnv, resolveRunDir, resolveWorkDir } from "../env.js";
import { GhostyRuntime } from "../runtime/ghostyRuntime.js";

function resolveProjectDir(envProjectDir: string | undefined): string {
  const configured = envProjectDir?.trim();
  if (configured) return resolve(process.cwd(), configured);
  const here = dirname(fileURLToPath(import.meta.url));
  // src/tui/startTui.ts -> <repo>/src/tui OR dist/tui/startTui.js -> <repo>/dist/tui
  return resolve(here, "..", "..");
}

export async function startTui(initialRuntime: GhostyRuntime): Promise<void> {
  let runtime = initialRuntime;

  const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
    // In the harness architecture, cwd is the caller launch directory.
    // Project config/prompts are anchored separately.
    const env = loadEnv();
    const projectDir = resolveProjectDir(env.GHOSTY_PROJECT_DIR);
    const workDir = resolveWorkDir(env, cwd, projectDir);

    const config = loadConfig(projectDir);
    const runDir = resolveRunDir(env);

    runtime = await GhostyRuntime.create({
      projectDir,
      workDir,
      runDir,
      env,
      config,
      coordinatorSessionManager: sessionManager,
      coordinatorSessionStartEvent: sessionStartEvent,
    });

    const services = runtime.getCoordinatorServices();
    return {
      session: runtime.getCoordinatorSession(),
      services,
      diagnostics: services.diagnostics ?? [],
      extensionsResult: runtime.getCoordinatorExtensionsResult(),
      modelFallbackMessage: runtime.getCoordinatorModelFallbackMessage(),
    } as any;
  };

  const coordinator = runtime.getCoordinatorHandle();
  const services = runtime.getCoordinatorServices();
  const diagnostics = services.diagnostics ?? [];

  const runtimeHost = new AgentSessionRuntime(
    coordinator.session as any,
    services,
    createRuntime,
    diagnostics,
    runtime.getCoordinatorModelFallbackMessage(),
  );

  const mode = new InteractiveMode(runtimeHost, { verbose: true });
  await mode.run();
}

