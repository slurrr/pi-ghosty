# pi-ghosty

pi-ghosty is a **Pi extension** that turns Pi into a small multi-peer “ghost in the machine” for your day-to-day terminal life.

this repo is contributor-facing: it contains the extension entrypoint, orchestration helpers, and prompt parts

## what runs

the extension entrypoint is `.pi/extensions/ghosty/index.ts`

the shared code it uses lives under `lib/` (`delegation/`, `memory/`, `workflow/`, `extensions/`, `config/`)

all durable state/artifacts go under `runDir` (default `~/runs/pi-ghosty`, override `GHOSTY_PI_RUN_DIR`)

## prereqs

- node.js (tested with node 24)
- (optional) hindsight at `http://localhost:8888` for memory
- (optional) vllm at `http://localhost:8002/v1` for local models

## setup

```bash
cp .env.example .env
npm install
```

## run

```bash
npm run dev
```

## verify

```bash
npm run typecheck
npm run smoke:pi-ext
```

## useful commands (in pi)

- `/ghosty status`
- `/ghosty smoke`
- `/ghosty workflow` (debug view; should be automated in normal use)
- `/ghosty memory` / `/ghosty memory full` (what got injected)

## scripts

- `npm run memory -- --all` (print latest memory receipts)
- `npm run memory -- --agent coordinator --full`

## config

config: `pi-agent.json` (override with `GHOSTY_AGENT_CONFIG_PATH`)

memory defaults use split banks:
- procedural: `pi-ghosty-procedural`
- personal: `pi-ghosty-personal`
- coordinator recalls personal first, then procedural
- working peers recall procedural only

## docs

- `AGENTS.md` minimal agent contract
- `docs/README.md` docs index
- `docs/decisions/` architecture decision records
- `docs/observations/` evidence checklists for live runs
- historical migration docs live under `docs/archive/`
