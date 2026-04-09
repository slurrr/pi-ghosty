import {
  AgentSessionRuntime,
  InteractiveMode,
  type CreateAgentSessionRuntimeFactory,
} from "@mariozechner/pi-coding-agent";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { loadConfig } from "../config/loadConfig.js";
import { loadEnv, resolveRunDir } from "../env.js";
import { GhostyRuntime } from "../runtime/ghostyRuntime.js";

export async function startTui(initialRuntime: GhostyRuntime): Promise<void> {
  let runtime = initialRuntime;

  const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
    // In the harness architecture, we treat `cwd` as the sandbox/workDir.
    // Project config/prompts live in a fixed projectDir.
    const projectDir = resolve(homedir(), "code", "dev", "pi-ghosty");
    const workDir = cwd;

    const env = loadEnv();
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

