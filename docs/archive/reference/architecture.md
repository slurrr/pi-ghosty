# Architecture (working notes)

This is a working document. It describes current structure without locking future design.

## Layers

### Frontends (IO)
- **TUI**: pi interactive mode hosted on the coordinator session (`src/tui/startTui.ts`).
- **Telegram**: provided via upstream `pi-telegram` extension (installed separately; see `docs/decisions/0005-telegram-via-pi-telegram.md`).

### Runtime (orchestration)
- `GhostyRuntime` owns:
  - coordinator + peer session lifecycle
  - delegation (`delegate` tool)
  - peer report extraction (`peer_report` tool)
  - traces + artifacts

File: `src/runtime/ghostyRuntime.ts`

### Session construction
- `createGhostySession()` builds one configured `AgentSession` using pi services:
  - model registry and provider registration (vLLM OpenAI-compatible)
  - resource loader (pi default system prompt + project append + peer prompt parts)
  - extensions (tool gating, memory, debug commands, input transforms)

File: `src/pi/createSession.ts`

## Prompt composition

### System prompt
- Base: pi default system prompt generator (tools + guidelines + docs + date + cwd).
- Project append: `.pi/APPEND_SYSTEM.md`.
- Per-peer: `peers/<peer>/*.md` appended for that session.
- For non-coder peers, the first sentence is replaced to match the role (surgical override in session creation).

## Tools and delegation
- Coordinator can call `delegate(peerName, task, context?, expectedOutput?)`.
- Runtime prompts the target peer session.
- Peer is expected to call `peer_report(...)`.
  - `peer_report` returns minimal visible content and puts structured data in tool result `details`.
- Runtime returns the structured result to the coordinator as the `delegate` tool result.

Fallback:
- If `peer_report` is missing, runtime retries once with a minimal instruction, then falls back to last assistant text.

## State locations
- Repo root: code + prompt sources.
- Run root: runtime state (`~/runs/pi-ghosty` by default, override via `GHOSTY_RUN_DIR`):
  - sessions: `data/sessions/<agent>/...`
  - traces: `data/traces/...`
  - artifacts: `data/artifacts/...`

## Extensions (current)
- `system` debug command (TUI): `src/extensions/systemDebugExtension.ts`
- explicit peer addressing (`@coder`, etc.): `src/extensions/explicitPeerAddressingExtension.ts`
- tool allowlist gating: `src/extensions/toolGatingExtension.ts`
- tool policy + tool trace: `src/extensions/toolPolicyExtension.ts`
- memory retain/recall: `src/extensions/memoryExtension.ts`
