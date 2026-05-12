# Spec: V1 Implementation Plan

## Problem
Implement a v1 single-model, multi-peer system (Corroborator + specialist peers) using pi-mono primitives.

Primary goals:
- Delegation that feels seamless (user talks to the Corroborator; peers are invisible unless asked).
- Tool-first structured peer results (host-owned schema; model fills it by calling a tool).
- Lightweight safety + trace/persistence rooted outside the repo.

## Status (as of 2026-04-04)
Implemented:
- Config + env loading (`pi-agent.json`, `src/config/*`, `src/env.ts`)
- Prompt-part assembly from `peers/<peer>/*.md` (`src/prompts/loadPeerPromptParts.ts`)
- vLLM-backed `AgentSession` creation (`src/pi/createSession.ts`)
- Corroborator + peer session lifecycle + delegation via a `delegate` tool (`src/runtime/*`)
- Structured peer result reporting via `peer_report` tool call (`src/runtime/peerReportTool.ts`) + validation (`src/runtime/contracts.ts`)
- Fallback when `peer_report` is missing: retry once, then use last assistant text (`src/runtime/ghostyRuntime.ts`)
- Tool allowlist gating per agent (`src/extensions/toolGatingExtension.ts`)
- Argument-level tool safety (`src/extensions/toolPolicyExtension.ts`)
- Runtime JSONL trace + minimal artifacts (`src/logging/jsonlTrace.ts`, `src/artifacts/store.ts`)
- Hindsight recall/retain hooks (`src/extensions/memoryExtension.ts`)
- PI TUI entrypoint hosted on corroborator session (`src/tui/startTui.ts`, `src/index.ts`)
- Debug commands in TUI (`/system`, `/system guidelines`) via extension (`src/extensions/systemDebugExtension.ts`)
- Explicit peer addressing (`@coder`, etc.) via extension (`src/extensions/explicitPeerAddressingExtension.ts`)

## Scope
This spec documents the v1 shape we’re building (and the choices that keep it lightweight).

In scope:
- Corroborator runtime
- Peer session lifecycle
- Structured delegation contract
- Tool safety policy (at least: shell timeout, file path boundaries)
- Session trace and artifact persistence
- PI TUI entrypoint
- Telegram via upstream `pi-telegram` extension (optional capability)

Out of scope:
- Parallel peer execution
- Web search
- Rich UI features
- Advanced memory tuning beyond the current Hindsight integration
- Replacing pi-mono session persistence

## Requirements
### Runtime core
- The user talks only to the Corroborator.
- The Corroborator can delegate to `coder`, `researcher`, `reviewer`, and `memory`.
- Peer sessions are persistent and resumable.
- Delegation is sequential in v1.
- The runtime must have explicit spawn-vs-resume behavior:
  - create a peer session if none exists
  - resume the existing peer session by default
  - allow explicit reset later without redesign

### Delegation contract
- The Corroborator must hand peers a compact structured task envelope (host-defined shape).
- A peer returns a compact structured result (host-defined shape) by calling a tool.
- The host runtime owns the schema and validation; the model only fills fields.
- Tool-first reporting:
  - peers call `peer_report` once per delegation with the structured result
  - the runtime reads the structured payload from the tool result `details` and validates it
- Fallback (graceful):
  - if no `peer_report` tool call occurs, retry once with a minimal follow-up instruction
  - if still missing, use the peer’s last assistant text as `summary` (see `docs/decisions/0004-peer-report-retry.md`)

### Tools
- Tools remain config-gated per agent.
- v1 must enforce argument-level safety for “dangerous” tools (even if the tool is allowed by name):
  - shell timeout and max output
  - working directory boundary (project root)
  - file write/edit path limits (project root)
- The orchestrator should not own tool allowlist logic.

### Persistence
- Reuse pi-mono session persistence for conversation state.
- Add a lightweight JSONL trace for runtime events:
  - incoming user message
  - delegation start/end
  - peer used
  - tool call/result metadata
  - final corroborator reply
- Add a minimal artifact store for reusable outputs worth re-injecting.

### Interfaces
- Primary interface is pi TUI.
- Telegram is enabled via upstream `pi-telegram` extension (see `docs/decisions/0005-telegram-via-pi-telegram.md`).
- Interface code should route messages into the runtime and not duplicate orchestration logic.
- Support explicit peer addressing via input prefix (see `docs/decisions/0003-explicit-peer-addressing.md`).

## Constraints
- Reuse pi-mono components; add only project-specific glue.
- Prefer adding small modules over framework-style abstractions.
- Do not move prompt content into config.
- Do not rebuild session persistence, compaction, or resource loading already provided by pi-mono.
- Keep operational state in plain files (sessions, traces, artifacts).
- Runtime state must live outside the repo (default: `~/runs/pi-ghosty`), with an env override.

## Module Plan
This section intentionally stays short: most behavior is captured in `docs/decisions/*` and in the code.

Key modules:
- Orchestration: `src/runtime/ghostyRuntime.ts`
- Delegation tool: `src/runtime/delegateTool.ts`
- Peer reporting tool + schema: `src/runtime/peerReportTool.ts`, `src/runtime/contracts.ts`
- Tool gating + safety: `src/extensions/toolGatingExtension.ts`, `src/extensions/toolPolicyExtension.ts`
- Trace + artifacts: `src/logging/jsonlTrace.ts`, `src/artifacts/store.ts`
- Session/prompt build: `src/pi/createSession.ts`, `peers/*/*.md`, `.pi/APPEND_SYSTEM.md`

## File Responsibilities
- `src/pi/createSession.ts`
  - stay focused on building one configured session
  - do not absorb orchestration logic
- `src/extensions/memoryExtension.ts`
  - continue to own Hindsight retain/recall hooks
  - do not become a generic event bus
- `src/extensions/toolGatingExtension.ts`
  - remain the final config gate
- `src/runtime/*`
  - own corroborator behavior and peer orchestration

## Sequencing
For future work, prefer this order:
1. Dogfood (TUI) and tighten prompts/contracts only where needed.
2. Add determinism only when it pays for itself (runtime/extension support over “more prompting”).
3. Add observability before adding new features.

## Acceptance Criteria
Met:
- The Corroborator can delegate to a peer and reuse that peer session on subsequent tasks.
- Peers report results via `peer_report` with a host-validated schema, with a graceful fallback path.
- Runtime writes JSONL traces and stores minimal artifacts under an out-of-repo runDir (default: `~/runs/pi-ghosty`).
  - Tool policy hardening exists beyond tool-name allowlists.
  - PI TUI uses the same runtime path (or explicitly deferred with rationale).

## Rough Size
- Current implementation (including baseline runtime): about `596` LOC in `src/`
- Remaining production code: about `500–900` LOC (depending on how much tool policy + TUI we include in v1)
- Tests: about `150–250` LOC
- Expected total: about `1.2k–1.7k` LOC

## Open Questions
- How explicit the corroborator’s delegation trigger should be in v1 (once structured results exist):
  - prompt-driven with a strict output contract
  - a dedicated delegation tool exposed only to the corroborator
- Whether runtime traces should include full peer replies or only summarized records.
- Whether the first PI TUI cut should be shipped in v1 or immediately after Telegram runtime parity.
