import {
  AgentSessionRuntime,
  InteractiveMode,
  type CreateAgentSessionRuntimeFactory,
} from "@mariozechner/pi-coding-agent";
import { loadConfig } from "../config/loadConfig.js";
import { loadEnv, resolveRunDir } from "../env.js";
import { GhostyRuntime } from "../runtime/ghostyRuntime.js";

export async function startTui(initialRuntime: GhostyRuntime): Promise<void> {
  let runtime = initialRuntime;

  const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
    const env = loadEnv();
    const config = loadConfig(cwd);
    const runDir = resolveRunDir(env);

    runtime = await GhostyRuntime.create({
      rootDir: cwd,
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

