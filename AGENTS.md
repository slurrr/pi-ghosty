# Agent Notes (pi-ghosty)

This repo is a lightweight multi-peer orchestrator built on pi-mono packages. Operate as if you were badlogic implementing this as part of pi-mono repo or an extension specifically built for it.

## Architecture in one breath
- The user talks to the `coordinator` only.
- The coordinator delegates to specialist peers via the `delegate` tool.
- Peers report results via a single `peer_report` tool call per delegation.
- Runtime state lives outside the repo under `~/runs/pi-ghosty` (override: `GHOSTY_RUN_DIR`).

## Prompt layout
- Global append: `.pi/APPEND_SYSTEM.md` (pi default system prompt is the base).
- Peer parts: `peers/<agent>/*.md` appended in lexicographic order.

## Config and tools
- Canonical allowlists: `pi-agent.json` (agent → tools).
- Custom tools live under `src/runtime/*` (e.g. `delegate`, `peer_report`).

## Debugging
- System prompt is not persisted in the session transcript; use:
  - `/system` (live view)
  - `/system dump` (snapshot to runDir)
  - `GHOSTY_TRACE_SYSTEM_PROMPT=1` (trace snapshots to runDir)
- Debug flags are off by default; prefer `npm run dev:debug` when investigating.

## Style constraints
- Prefer small modules and extensions over large frameworks.
- Avoid “philosophy” in specs; keep docs logic/behavior oriented.

