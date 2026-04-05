# pi-ghosty

Native (TypeScript) single-model multi-peer agent host built on pi-mono packages, with:
- vLLM (`/v1/chat/completions`) as the single local model backend
- Hindsight for long-term memory (retain-all + observations)
- Telegram gateway (single-user v1)

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

## Notes
- Config lives in `pi-agent.json`.
- Shared system prompt addendum is `.pi/APPEND_SYSTEM.md` (pi default system prompt is used).
- Peer prompt parts live in `peers/<peer>/*.md` (all `.md` in that folder are appended in lexicographic order).
- Default interface is TUI. Set `GHOSTY_INTERFACE=telegram` to run the Telegram gateway.
