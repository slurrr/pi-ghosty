import { AgentSessionRuntime, InteractiveMode } from "@mariozechner/pi-coding-agent";
import type { GhostyRuntime } from "../runtime/ghostyRuntime.js";

export async function startTui(runtime: GhostyRuntime): Promise<void> {
  const coordinator = runtime.getCoordinatorHandle();
  const services = runtime.getCoordinatorServices();
  const diagnostics = services.diagnostics ?? [];

  const runtimeHost = new AgentSessionRuntime(
    coordinator.session as any,
    services,
    async () => {
      throw new Error("Session switching is not implemented in pi-ghosty TUI.");
    },
    diagnostics,
    runtime.getCoordinatorModelFallbackMessage(),
  );

  const mode = new InteractiveMode(runtimeHost, { verbose: true });
  await mode.run();
}

