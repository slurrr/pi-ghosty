# Spec: V1 Single-Model Multi-Peer Agent (pi-mono based)

## Problem
We want an “openclaw-like” experience (one ultra-capable agent) without the bloat and deadweight of adopting or trimming an
existing large system. The target is a **single local model** that can behave like multiple specialized agents (“peers”)
to share tool load and task focus, while the user interacts only with a single main Coordinator.

## Scope
V1 includes:
- A Coordinator agent (the only agent the user talks to).
- Specialist peers: `coder`, `researcher`, `reviewer`, plus a `memory` peer for memory operations.
- Single model served by vLLM on `http://localhost:8002` (initial: `omnicoder-9b`).
- Use OpenAI-compatible **Chat Completions** for v1 (`/v1/chat/completions`) with tool calling enabled.
- A config file in the agent-tree root (`pi-agent.json`) defining:
  - global defaults (model endpoint, compat flags, default sampling, default tool surface)
  - nested agent objects (Coordinator + peers), each able to override: tool surface, skills, sampling params, etc.
- Peer definitions stored under `peers/`.
- Prompt composition from markdown files on disk:
  - `.pi/SYSTEM.md` is the primary shared system prompt base for all agents
  - each peer has its own subfolder under `peers/<peer>/` and all `.md` files in that folder are assembled by a
    system builder module (prompts are not stored in config)
- Tool-calling peers (peers can directly call tools).
- Local PI TUI as a primary interface and a Telegram gateway as an additional IO channel (Telegram only for remote v1).
- Basic logging/tracing (JSONL) with bounded retention.
- Persistent sessions for Coordinator + peers (so each agent can build working context), augmented by long-term memory.

Out of scope / deferred:
- Web search / browsing tools (explicitly disabled for v1).
- Aggressive parallelism (parallel peer sessions and parallel tool calls): v1 is sequential.
- Dedicated embeddings server (TEI) for memory (v2).
- “Openclaw completeness” (plugins, workflows, fancy agent marketplace, etc.).
- “No-compaction” mode where we rely primarily on rolling window + memory recall (v2 goal).

## Requirements
### Multi-peer behavior (single model)
- The system uses one model endpoint (vLLM) and achieves multi-agent behavior via peer profiles + fresh sub-sessions.
- Coordinator delegates work to peers and receives concise results back (summary + artifacts + next actions).
- Peer sessions are context-isolated: only include the minimum task context and relevant artifacts, not full chat history.

### Memory (required)
- The Coordinator must have **active recall**: before responding, it retrieves relevant long-term memories and injects them
  into context in a bounded, low-bloat form.
- The system must support **learning over time** (not just transcript persistence).
- V1 adopts Hindsight (`vectorize-io/hindsight`) as the memory subsystem via its HTTP API:
  - `retain` after turns (store key facts/experiences/outcomes)
  - `recall` before turns (retrieve relevant memories)
  - `reflect` either on-demand or periodically (optional in early v1 but designed-in)
- Use Hindsight observations (background consolidation) as the default always-on “learning” loop (configurable).
- V1 defaults:
  - retain full transcripts (stable `document_id` per session; update the same document as the conversation grows)
  - enable observations so durable learnings are synthesized automatically after retain
- Observation scoping:
  - Use Hindsight `observation_scopes` so the durable “learned” layer focuses on useful scopes (e.g., `project:*`,
    `agent:*`, `user:*`) instead of producing noisy per-session observations by default.
 - `document_id` + tags strategy:
  - Retain one transcript document per agent session (Coordinator + each peer), each with a stable `document_id`.
  - Tag retained documents with `project:<name>`, `agent:<name>`, and `session:<id>`.

Memory peer responsibilities (v1):
- The `memory` peer is used for “memory operations” work (tuning retain/reflect missions, inspecting recall quality/debug
  traces, triggering manual reflect passes, creating bank templates/mental models).
- Core `retain`/`recall` calls should be deterministic host/orchestrator behavior, not delegated reasoning, so memory works
  even when the model is having a bad day.
- Memory must be safe-by-default:
  - redact secrets (API keys, tokens) and avoid storing raw sensitive tool output verbatim
  - limit recall payload size (token / item caps)
  - tag memories by project/session/agent to prevent cross-contamination (even in single-user v1)

### Sessions (persistent state)
- Each agent (Coordinator + peers) maintains a persistent session log (JSONL) so it can carry working context forward.
- Long-term recall comes from Hindsight; sessions are the short/medium-term working set and the audit trail.

### Tools and safety
- Peers can call tools directly (function/tool calling).
- Tool safety is enforced by config (`pi-agent.json`) at execution time.
- Default v1 stance is conservative:
  - no web search
  - limited file write/edit
  - limited shell execution (tight allowlist + timeouts)
  - expand permissions iteratively as trust increases
- Provider/API choice for v1:
  - Prefer OpenAI-style Chat Completions semantics (pi-mono’s `openai-completions` path).
  - Be able to add OpenAI Responses compatibility later, but don’t require it for v1.
- Tool execution ordering for v1:
  - Peer orchestration is sequential.
  - Tool execution should be sequential (even if the underlying runtime supports parallel execution), to simplify safety
    and debugging in v1.

### Prompt composition
We need predictable prompt assembly from markdown files:
- Shared base: `.pi/SYSTEM.md` (used by all agents).
- Context files: pi-style `AGENTS.md` concatenation is included as project context (baseline).
- Per-peer prompt parts: all `.md` files in `peers/<peer>/` are appended/assembled by a system builder module.
- Specialists should be “boring task rabbits” with minimal instruction.
- For debugging/auditability, we can reconstruct “what prompt did agent X run for call Y” via:
  - recording the list of included prompt-part file paths (in order), and
  - recording the final built system prompt string in the transcript/log.

### Interfaces
- Local interface: PI TUI for interacting with the Coordinator.
- Remote interface (v1): Telegram messaging with the Coordinator (bot-based), **single-user only**.

### Logging & artifacts
- Write a per-session JSONL trace capturing:
  - user messages (redacted as needed)
  - coordinator/peer messages (or hashes + references if too large)
  - tool calls + results
  - prompt build metadata (which files/parts were used)
- Bounded retention: size cap and/or rolling file handler (avoid retaining everything forever).
- Artifact store: a small, queryable list of “results worth reusing” (tool output summaries, file paths, extracted facts).

## Constraints
- Must be based on pi-mono as the foundation; keep custom glue thin.
- Model endpoint is vLLM on port `8002` and should be configurable for future endpoints.
- V1: sequential orchestration.
- Keep the system prompt compact and composable (avoid “blob prompts”).

## pi-mono Reuse Notes (Research)
- `@mariozechner/pi-coding-agent` provides an SDK entrypoint (`createAgentSession`) that constructs an `AgentSession`
  wrapper around `@mariozechner/pi-agent-core`’s `Agent`.
- `AgentSession` already integrates:
  - resource loading (AGENTS.md concatenation; `.pi/SYSTEM.md` replacement; `APPEND_SYSTEM.md` append)
  - skills, prompt templates, and extensions
  - session persistence to JSONL with branching + compaction
- Tool permission gates can be implemented without Coordinator ad-hoc logic:
  - `AgentSession` wires `agent.beforeToolCall` to extension `tool_call` handlers, which can `block` execution with a
    `reason`.
- vLLM should be treated as `openai-completions` for v1; pi-ai supports OpenAI-compat flags (`compat.*`) for servers
  like vLLM (e.g., `supportsDeveloperRole=false` when needed).

## Acceptance Criteria
- Running locally with vLLM at `http://localhost:8002`, the Coordinator can:
  - accept a user request via PI TUI and via Telegram
  - delegate to `coder`, `researcher`, `reviewer`, and `memory` peers
  - receive peer results and present a unified answer to the user
- A peer can call at least one tool successfully, and the tool runner enforces config permissions.
- The system can show (or log) which prompt parts were used for each peer call.
- JSONL trace is produced per session and does not grow without bound.
- Web search tools are not available/enabled in v1.
- Memory defaults are active:
  - observations are enabled by default
  - full-transcript retention is used by default (not “memory packets”)

## Open Questions
- Telegram details:
  - confirm the allowlist mechanism (single permitted Telegram user ID) and bot token handling
  - how to map the allowed chat ID to the single Coordinator session (persistent vs ephemeral)?
- Prompt composition format:
  - what is the deterministic ordering rule for assembling `.md` files in `peers/<peer>/` (lexicographic; numeric prefixes)?
  - do we allow nested subfolders or only flat directories for v1?
- Tool permission model:
  - global registry + per-peer allowlist vs “peer owns a tool subset”
  - how to handle dangerous tool categories (exec, file writes, git)?
- Artifact store format: JSONL, sqlite, plain files? (Prefer simplest that meets debugging needs.)
 - How much of pi’s existing resource system do we reuse directly?
   - `AGENTS.md` concatenation + `.pi/SYSTEM.md` + `APPEND_SYSTEM.md`
   - prompt templates / skills discovery
   - vs custom prompt-part composition under `peers/` with our own loader
- Memory integration details:
  - bank strategy: one bank w/ tags vs per-agent banks (v1 single-user suggests one bank + tags)
  - what exactly to retain (policy) vs rely on reflect
  - whether Hindsight’s retain/reflect LLM uses the same vLLM model or a separate memory-optimized model
  - `document_id` scheme + tag taxonomy (`project:*`, `agent:*`, `session:*`) and how they map to recall filters

## Plan (First Draft)
1. **Inventory pi-mono building blocks**
   - Confirm the concrete “reuse” approach:
     - Use `@mariozechner/pi-coding-agent` SDK (`createAgentSession`, `AgentSession`) to avoid re-building tool parsing,
       session plumbing, resource loading (AGENTS/SYSTEM/skills), and event streaming.
     - Use `@mariozechner/pi-agent-core` hooks (`beforeToolCall`/`afterToolCall`, `toolExecution`) via the `AgentSession`
       wrapper to implement config-gated safety and v1 sequential tool execution.
   - Confirm vLLM OpenAI-compat settings likely needed for `omnicoder-9b` (commonly: `supportsDeveloperRole=false`,
     `supportsReasoningEffort=false`; verify `supportsStrictMode` if needed).
   - Document what we will reuse vs what we must implement as thin glue.

2. **Define config shape (`pi-agent.json`)**
   - File name: `pi-agent.json`.
   - Global defaults: vLLM baseUrl `http://localhost:8002/v1`, API `openai-completions`, compat flags.
   - Coordinator + peers (coder/researcher/reviewer) definition as nested objects.
   - Per-agent: tool surface/permissions, sampling params, enabled skills.
   - Decide defaults for v1 safety (no web, constrained exec/write).

3. **Define peer prompt layout (`peers/`)**
   - Create per-peer prompt folders containing `.md` parts (role brief, tool usage norms).
   - Implement deterministic prompt assembly rules (file ordering + trace metadata).
   - Ensure `.pi/SYSTEM.md` is the shared base prompt for all agents.

4. **Coordinator orchestration loop**
   - Coordinator receives user messages, decides when to delegate, and spawns peer sub-sessions (same model endpoint).
   - Coordinator manages peer lifecycle and merges peer outputs into a user-facing response.
   - Prefer implementing orchestration as a pi extension (so it works in PI TUI and in the SDK host).

5. **Tool execution pipeline (config-gated)**
   - Central tool registry.
   - Tool calls are attributed to the active agent (Coordinator or specific peer).
   - Enforce allowlist + limits at tool execution time (timeouts, path allowlists, command allowlists).
   - Implement enforcement as a config-backed hook (e.g., via `beforeToolCall`/extension `tool_call` handler), not
     Coordinator ad-hoc logic.

6. **Interfaces**
   - Hook into PI TUI (local).
   - Implement Telegram gateway for the Coordinator (v1):
     - message -> session routing
     - send responses and status updates (e.g., “delegating to reviewer…”)

7. **Logging + bounded retention**
   - Per-session JSONL trace, plus rotation/size cap.
   - Include prompt build metadata and tool call records.

8. **Smoke test scenarios**
   - Coordinator-only conversation.
   - Delegate to each peer and get back structured summary.
   - Peer calls a permitted tool; a forbidden tool is denied by config.
  - Telegram round-trip works end-to-end.
  - Memory: retain+recall loop works end-to-end (coordinator retrieves relevant memories on the next turn).

## V2 Direction (No-Compaction Mode)
Goal: stop relying on transcript compaction and instead use:
- a rolling context window (last N turns)
- Hindsight recall injection every turn
- targeted artifact fetch when the model needs raw details

This is gated on recall quality: if recall reliably surfaces the right constraints/decisions, we can keep contexts small
and predictable while retaining full audit trails in logs.
