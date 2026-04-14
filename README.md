# pi-ghosty

Native (TypeScript) single-model multi-peer agent host built on pi-mono packages, with:
- vLLM (`/v1/chat/completions`) as the single local model backend
- Hindsight for long-term memory (retain-all + observations)
- Telegram capability via upstream `pi-telegram` extension (optional)

## Prereqs
- Node.js (tested with Node 24)
- vLLM running at `http://localhost:8002/v1`
- Hindsight running at `http://localhost:8888`

## Setup
```bash
cp .env.example .env
npm install
```

## Run
```bash
npm run dev
```

## Debug
All debug flags default off (`0`/unset). Quick “turn everything on”:
```bash
npm run dev:debug
```

Useful flags:
- `GHOSTY_TRACE_SYSTEM_PROMPT=1`: persist effective system prompt snapshots (only when it changes)
- `GHOSTY_DEBUG_TOOL_BLOCKS=1`: trace tool blocks (policy + gating)
- `GHOSTY_DEBUG_TOOL_SURFACE=1`: log allowed tool surface once per session
- `GHOSTY_DEBUG_PROMPT_PARTS=1`: log which peer prompt part files were loaded (hashes)
- `GHOSTY_AGENT_CONFIG_PATH=./pi-agent-canonical.json`: optional config override for ghosty launches; defaults to `./pi-agent-canonical.json`
- `/ghosty models`: show scoped model status plus configured presets
- `/ghosty models preset <name>`: apply a configured `modelScopePresets` entry to Pi `enabledModels`

## Notes
- Canonical unified config now lives in `pi-agent-canonical.json` and is the default config used by ghosty.
- `pi-agent-local.json` and `pi-agent-frontier.json` remain as compatibility/migration examples while this branch finishes proving the unified shape.
- `modelScopePresets` are helpers for applying Pi `enabledModels` presets; Pi `/scoped-models` remains canonical.
- `pi-agent.json` remains as a legacy compatibility file while this branch finishes the migration.
- Shared system prompt addendum is `.pi/APPEND_SYSTEM.md` (pi default system prompt is used).
- Peer prompt parts live in `peers/<peer>/*.md` (all `.md` in that folder are appended in lexicographic order).
- Interface is pi TUI (primary). For Telegram, use the upstream `pi-telegram` extension (see `docs/decisions/0005-telegram-via-pi-telegram.md`).
