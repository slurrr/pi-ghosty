# Spec: V1 Implementation Plan (Updated)

## Problem
The architectural spec is locked, and we want a thin, debuggable v1 that actually behaves like a single-model, multi-peer
system (Coordinator + specialist peers) while staying close to pi-mono primitives.

This repo started as a scaffold and now includes a first working cut of the runtime. The remaining work is mostly about
making delegation + tooling + logging match the v1 spec expectations (structured handoffs, bounded traces, safer tool
policy), and adding a local PI TUI entrypoint.

## Status (as of 2026-04-04)
Implemented (baseline):
- Config + env loading (`pi-agent.json`, `src/config/*`, `src/env.ts`)
- Prompt-part assembly from `peers/<peer>/*.md` (`src/prompts/loadPeerPromptParts.ts`)
- vLLM-backed `AgentSession` creation (`src/pi/createSession.ts`)
- Tool allowlist gating by agent (`src/extensions/toolGatingExtension.ts`)
- Hindsight recall/retain hooks (`src/extensions/memoryExtension.ts`)
- Coordinator + peer session lifecycle + delegation via a `delegate` tool (`src/runtime/*`)
- Telegram gateway routes IO through the runtime (`src/telegram/startTelegramBot.ts`, `src/index.ts`)

Not implemented yet (spec gaps):
- Structured peer result contract (JSON) + parsing/validation
- Runtime JSONL trace + bounded retention
- Artifact store (minimal)
- Argument-level tool safety policy (path/timeout), beyond tool-name allowlists
- PI TUI entrypoint

## Scope
This spec covers the code required to finish and harden the v1 runtime around the existing baseline.

In scope:
- Coordinator runtime
- Peer session lifecycle
- Structured delegation contract
- Tool safety policy (at least: shell timeout, file path boundaries)
- Session trace and artifact persistence
- Telegram integration with the coordinator runtime
- PI TUI entrypoint

Out of scope:
- Parallel peer execution
- Web search
- Rich UI features
- Advanced memory tuning beyond the current Hindsight integration
- Replacing pi-mono session persistence

## Requirements
### Runtime core
- The user talks only to the Coordinator.
- The Coordinator can delegate to `coder`, `researcher`, `reviewer`, and `memory`.
- Peer sessions are persistent and resumable.
- Delegation is sequential in v1.
- The runtime must have explicit spawn-vs-resume behavior:
  - create a peer session if none exists
  - resume the existing peer session by default
  - allow explicit reset later without redesign

### Delegation contract
- The Coordinator must hand peers a compact structured task envelope (host-defined shape).
- A peer must return a compact structured result (host-defined shape).
- The host runtime owns the contract shape and parsing/validation. The model only fills it.
- v1 should be robust to “non-JSON” peer responses:
  - attempt strict parse first
  - fall back to treating the peer’s reply as plain text summary
  - log parse failures for debugging

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
  - final coordinator reply
- Add a minimal artifact store for reusable outputs worth re-injecting.

### Interfaces
- Telegram should talk to the Coordinator runtime, not directly to a raw `AgentSession`.
- PI TUI should use the same runtime path as Telegram.
- Interface code should stay thin and not duplicate orchestration logic.

## Constraints
- Keep the implementation thin and native to pi-mono.
- Prefer adding small modules over framework-style abstractions.
- Do not move prompt content into config.
- Do not rebuild session persistence, compaction, or resource loading already provided by pi-mono.
- Keep the first cut debuggable with plain files and logs.

## Module Plan
### Phase 1: Baseline runtime (DONE)
Primary deliverable: coordinator-driven multi-peer execution with persistent peer sessions.

Files:
- `src/runtime/ghostyRuntime.ts`
  - creates coordinator + peer sessions on demand
  - injects the `delegate` tool into the coordinator
  - sequential delegation to peers
- `src/runtime/delegateTool.ts`
  - tool definition: `delegate(peerName, task, context?, expectedOutput?)`
- `src/runtime/contracts.ts`
  - peer names + delegation prompt builder

Notes:
- Current peer result is “best-effort”: we return the peer’s last assistant text as `summary`.
- The `delegateRequestSchema` is defined but not used for validation yet.

### Phase 2: Structured delegation contract (NEXT)
Primary deliverable: predictable, parseable peer results that the Coordinator can reliably consume.

Files:
- Update `src/runtime/contracts.ts`
  - define `PeerResultV1` schema (zod) with fields:
    - `summary` (required)
    - `findings` (optional string[])
    - `artifacts` (optional string[])
    - `next_actions` (optional string[])
- Update `src/runtime/ghostyRuntime.ts`
  - parse the peer reply as JSON first
  - fall back to plain-text summary if parsing fails
- Update `src/runtime/delegateTool.ts`
  - validate inputs with zod (or reuse zod schema directly)
  - return `details` with structured result when available

Implementation note:
- Keep the handoff prompt boring and strict: “Return ONLY a single JSON object matching this schema”.
  If we later need richer results, we can extend the schema without reworking the host plumbing.

### Phase 3: Tool policy hardening (NEXT)
Primary deliverable: safety checks beyond tool-name allowlists.

Files:
- Add `src/extensions/toolPolicyExtension.ts`
  - enforce path boundaries for `write` / `edit`
  - enforce timeout/output caps for `bash`
- Update `src/pi/createSession.ts`
  - register the new extension for all sessions

Notes:
- This should not require a large config redesign for v1. Start with hard-coded safe defaults (project-root only),
  then optionally add config overrides later.

### Phase 4: Trace + artifacts (NEXT)
Primary deliverable: runtime-level JSONL trace and a minimal artifact store.

Files:
- Add `src/logging/jsonlTrace.ts`
  - append structured runtime events under `data/traces/<sessionId>.jsonl`
- Add `src/artifacts/store.ts`
  - append/read artifact summaries under `data/artifacts/<project>.jsonl`
- Update `src/runtime/ghostyRuntime.ts`
  - emit trace events for:
    - user message
    - coordinator reply
    - delegation start/end
    - tool call block reasons (when available)

### Phase 5: PI TUI (NEXT / OPTIONAL for strict v1)
Primary deliverable: local UI entrypoint using the exact same runtime path as Telegram.

Files:
- `src/telegram/startTelegramBot.ts`
  - already routes messages into the runtime
- `src/tui/startTui.ts`
  - implement a minimal local loop (pi-tui if we adopt it, or a temporary stdin loop)
- `src/index.ts`
  - bootstrap services and choose interfaces

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
  - own coordinator behavior and peer orchestration

## Sequencing
1. Finish structured delegation contract + parsing.
2. Add tool policy hardening (argument-level safety).
3. Add JSONL trace + minimal artifact store.
4. Add PI TUI (optional for strict v1; required for parity with spec).

This order matters because the delegation contract determines what can be logged and reused, and tool policy hardening
defines what peers can safely do.

## Acceptance Criteria
- Baseline (met today):
  - Telegram uses the runtime (not a raw `AgentSession.prompt()` call path).
  - The Coordinator can delegate to at least one peer and resume that peer session on the next task.
- Remaining for “spec-complete v1”:
  - Peers return a structured result that the Coordinator can parse/validate (with plain-text fallback).
  - Runtime events are written to JSONL with bounded retention.
  - Tool policy hardening exists beyond tool-name allowlists.
  - PI TUI uses the same runtime path (or explicitly deferred with rationale).

## Rough Size
- Current implementation (including baseline runtime): about `596` LOC in `src/`
- Remaining production code: about `500–900` LOC (depending on how much tool policy + TUI we include in v1)
- Tests: about `150–250` LOC
- Expected total: about `1.2k–1.7k` LOC

## Open Questions
- How explicit the coordinator’s delegation trigger should be in v1 (once structured results exist):
  - prompt-driven with a strict output contract (recommended)
  - a dedicated delegation tool exposed only to the coordinator (already exists; likely keep)
- Whether runtime traces should include full peer replies or only summarized records.
- Whether the first PI TUI cut should be shipped in v1 or immediately after Telegram runtime parity.
