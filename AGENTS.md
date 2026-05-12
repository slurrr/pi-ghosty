# AGENTS (pi-ghosty)

this repo is an **extension-only** pi package. it adds a corroborator + peer operating model (multi-peer delegation), memory wiring (hindsight), and durable receipts.

entrypoint
- `.pi/extensions/ghosty/index.ts`

agents
- user talks to `corroborator`
- corroborator delegates to peers: `coder`, `researcher`, `reviewer`, `memory`
- peers must finish a delegated job by calling `peer_report`

config + prompts
- config file: `pi-agent.json` (default; override with `GHOSTY_AGENT_CONFIG_PATH`)
- shared system addendum: `.pi/APPEND_SYSTEM.md`
- peer prompt parts: `peers/<agent>/*.md` (lexicographic order)

runtime artifacts
- `runDir` default `~/runs/pi-ghosty` (override `GHOSTY_PI_RUN_DIR`)
- key locations:
  - sessions: `runDir/data/sessions/**`
  - traces: `runDir/data/traces/**`
  - delegation reports: `runDir/data/delegation-reports/**`
  - memory receipts: `runDir/data/memory/receipts/**`

how to verify
- `npm run typecheck`
- `npm run smoke:pi-ext`

docs navigation
- `README.md` contributor quickstart
- `docs/reference/` curated reference (especially hindsight)
- `docs/specs/` + `docs/decisions/` permanent records
- `docs/archive/` old/duplicative migration notes

