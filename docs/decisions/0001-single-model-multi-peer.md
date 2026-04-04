# 0001: Single-Model, Multi-Peer Agent Architecture (pi-mono based)

## Status
Approved

Allowed values: `Pending`, `Approved`, `Superseded`

## Context
We want a lightweight “openclaw-like” agent system that feels like one ultra-capable agent, but is implemented as a team of
specialized peers running on a single machine with a single local model (low VRAM, low operational complexity).

Constraints and preferences:
- Single local model served by vLLM at `http://localhost:8002` (initial model: `omnicoder-9b`).
- Multi-agent behavior is achieved via *profiles* (different system prompts + toolsets), not by swapping models.
- The main “Coordinator” agent is the only user-facing agent (PI TUI + Telegram messaging for v1).
- Specialist peers directly call tools; tool safety is enforced by config, not by ad-hoc logic in the orchestrator.
- v1 can be sequential; parallel tool calls are a future goal.
- We want to leverage pi-mono packages as much as possible, and keep our layer thin and composable.
- vLLM is treated as OpenAI Chat Completions compatible for v1 tool-calling (`/v1/chat/completions`).
- Telegram policy for v1 is single-user (explicit allowlist), to keep the gateway simple and safe.
- Config lives in the agent-tree root and defines global defaults + nested agents (tools, skills, sampling, overrides).
- Prompts are not defined in config. Each peer has a folder of `.md` prompt parts assembled by a system builder module.
- `.pi/SYSTEM.md` is the primary shared prompt building block used by all agents (Coordinator + peers).

## Decision
Adopt a **single-model, multi-peer** architecture built on pi-mono components:

1. **Agent Profiles (“Peers”)**
   - Peers are defined as prompt profiles (system prompt composed from multiple markdown files) plus configuration (tools,
     sampling params, skills).
   - Store peer definitions under `peers/` (not `agents/`) to emphasize “profiles/roles” rather than separate models.

2. **Coordinator-Orchestrated Sessions**
   - The Coordinator is the only agent the user interacts with.
   - The Coordinator can delegate tasks to specialist peers by spawning fresh peer sessions using the same vLLM model.

3. **Config-Gated Tool Execution**
   - Tool execution is gated by a config file (`pi-agent.json`) that defines:
     - agent tree (Coordinator + peers)
     - per-agent tool allowlists / permissions
     - per-agent sampling parameters
     - optional skills
   - The orchestrator routes tool calls but does not “hand-roll” allowlist enforcement; the tool layer consults config.

4. **Telegram Gateway (v1)**
   - Add a light Telegram interface for communicating with the Coordinator (in addition to local PI TUI).
   - Telegram is treated as an IO channel, not a separate agent.

5. **Execution Mode**
   - v1 runs peer calls sequentially (simple and predictable).
   - Parallel tool calls / parallel peers are explicitly deferred until after v1 correctness and safety are established.

## Consequences
Positive:
- Matches the “one model, many roles” vision while keeping VRAM and complexity low.
- Allows focused peer prompts and contexts (context isolation), reducing prompt bloat for the Coordinator.
- Centralizes safety decisions in config, supporting iterative trust-building (gradually add tools / permissions).

Tradeoffs / Costs:
- We need a robust tool-call capture and execution layer that can attribute calls to a specific peer and apply config rules.
- Prompt composition adds complexity (file ordering, shared vs peer-specific parts, debugging “what prompt did we run?”).
- Parallelism is intentionally postponed; v1 responsiveness depends on sequential orchestration and model throughput.

Follow-ups:
- Write the v1 spec and plan (tools, prompt composition, Telegram IO, logging).
- Decide what to reuse from pi-mono (AgentSession, TUI, tools, skills) and what thin glue we need to add.
- Decide peer persistence and memory approach (stateless vs per-peer sessions vs hybrid memory files).
