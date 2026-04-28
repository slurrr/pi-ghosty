# Current Goal
- Finalize `pi-ghosty` as a daily-driver agent harness with reliable multi-peer routing and deep web grounding.
- Revisit and refine `pi-agent.json` default model selections.
- Harden the `WorkflowMonitor` logic in `lib/workflow/`.

# Current State
- **`bb-browser` Grounding**: Verified and stable via CDP port `19825`. Successfully bypassing anti-bot measures using the authenticated profile link.
- **Architecture Refactor**: **COMPLETED**. 
  - `src/` renamed to `lib/`. 
  - Legacy runtime remnants (`lib/pi/`, `lib/env.ts`, `lib/memory/hindsight.ts`) deleted.
  - vLLM discovery logic successfully migrated to `lib/config/vllmProvider.ts`.
  - Extension entry point (`.pi/extensions/ghosty/index.ts`) slimmed down; utilities moved to `lib/utils/helpers.ts`.
- **Visibility (War Room)**: **COMPLETED**. 
  - `/ghosty peer open` now defaults to a "War Room" layout: coordinator on left, peer interactive session top-right, and live JSONL log tail bottom-right.
  - `GHOSTY_SAMPLING_TRACE=1` wired in to stream raw LLM tokens to the log pane.
- **Model Routing**: Agent-specific `defaultModel` and `thinkingLevel` enforced from `pi-agent.json` for all peers on startup.

# Decisions
- **Extension-Only Model**: All future development happens in `.pi/extensions/ghosty/` (brain) and `lib/` (modular body).
- **War Room Default**: Visibility into peer "frozen" states is prioritized via live log tailing in a vertical tmux split.
- **Grounding Protocol**: Favor `bb-browser open` -> `snapshot`/`eval` for robustness over brittle site adapters.

# Open Problems
- `pi-agent.json` model defaults: Need to verify if the current mix of `gemini-3-flash-preview` and `gpt-5.3-codex` is optimal for the current workloads.
- Workflow Monitor: Current screening is deterministic; needs verification for proactive interrupt power in long-running loops.

# Resume Instructions
1. Review `pi-agent.json` default models.
2. Verify local vLLM registration via new `vllmProvider.ts` wiring.
3. Proceed to hardening `WorkflowMonitor` in `lib/workflow/`.
