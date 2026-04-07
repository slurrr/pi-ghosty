# Current Goal
Stabilize pi-ghosty for prompt/role iteration with strong observability:
- tool visibility in traces (tool_call/tool_result)
- Hindsight recall/retain timing/size traces
- make session commands like `/new` behave like upstream pi

# Current State
- Multi-peer runtime works: coordinator delegates; peers return structured results via `peer_report` (captured inside `delegate` tool result `details`).
- Run state lives under `~/runs/pi-ghosty` (sessions, traces, system prompt snapshots).
- System prompt snapshots are traced under `~/runs/pi-ghosty/data/system-prompts/<agent>/<sessionId>.jsonl`.
- Hindsight is now reachable at `http://127.0.0.1:8888/health` and recall injection is active (adds `# Recalled Memory (...)` blocks).
- `/new` now works (runtime factory no longer throws; coordinator session can be replaced in the TUI).

# Decisions
- Context window and max tokens are now config-driven in `pi-agent.json` under `defaults.model`.
- Tool tracing was re-enabled via `toolPolicyExtensionFactory` using `GHOSTY_DEBUG_TOOL_BLOCKS` (logs tool_call/tool_result/tool_policy_block).
- Memory can be disabled without touching code via `GHOSTY_DISABLE_MEMORY=1` (default enabled).

# Open Problems
- `/reload` still does not hot-reload the inline extension factories because they are not file-discovered `.pi/extensions/*` modules. Long-term direction: move ghosty behavior into project-local extensions to get true `/reload`.
- Memory recall is noisy and can contain stale facts (e.g., recalling old contextWindow values). Needs a memory policy pass (retain/recall filtering).
- Need to validate new memory timing traces show up in `~/runs/pi-ghosty/data/traces/<agent>/<sessionId>.jsonl` as `memory_recall`/`memory_retain`.

# Resume Instructions
1. Run with high visibility:
   - `GHOSTY_DEBUG_ALL=1 GHOSTY_DEBUG_TOOL_BLOCKS=1 npm run dev`
2. In TUI, do a simple delegation and verify traces include tool calls/results:
   - `~/runs/pi-ghosty/data/traces/coordinator/<sessionId>.jsonl` now should contain `tool_call` / `tool_result` events.
3. Verify memory timing events:
   - look for `memory_recall` / `memory_retain` in `~/runs/pi-ghosty/data/traces/<agent>/<sessionId>.jsonl`.
4. If you want to work on prompts without memory noise:
   - run with `GHOSTY_DISABLE_MEMORY=1`.
5. Longer-term refactor (pi-style hot reload):
   - move inline extension factories into `.pi/extensions/` and remove `resourceLoaderOptions.extensionFactories` so `/reload` actually reloads ghosty behavior.
