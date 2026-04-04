# 0002: Long-Term Memory via Hindsight

## Status
Approved

Allowed values: `Pending`, `Approved`, `Superseded`

## Context
The multi-peer system needs **long-term persistence** to be useful and trustworthy:
- The Coordinator must remember prior decisions, constraints, and “what worked / what failed”.
- Specialist peers (especially `coder` and `researcher`) need persistent context and **active recall** to avoid “light-duty only”
  behavior.
- Purely persistent chat logs (even with compaction) are not sufficient: they bloat context windows, drift, and don’t
  provide reliable recall or learning.

We want a memory mechanism that:
- supports **retain / recall / reflect** (learning), not just vector search
- is model/provider agnostic
- is well documented and “plug-and-play”
- can run locally

Candidate: `vectorize-io/hindsight` (MIT) – exposes an HTTP API and provides clients for Python and TypeScript.

## Decision
Integrate **Hindsight** as the long-term memory subsystem for the Coordinator + peers.

High-level design:
- Run Hindsight as a sidecar service (local) with HTTP API (default `http://localhost:8888`).
- Use **one memory bank** for v1 (single-user), with tags to scope memories by agent/peer/session/project if needed.
- Agent runtime responsibilities:
  - **Retain**: store relevant events (user requests, tool calls/results, outcomes) after each turn.
  - **Recall**: before generating a response, fetch a bounded set of relevant memories and inject them as context.
  - **Reflect / Consolidate**:
    - Use Hindsight’s observation consolidation (background learning) as the default “always-on” learning loop.
    - Use `reflect` explicitly when the user asks for deeper synthesis, or as a scheduled background job.

Memory peer:
- Add a `memory` peer whose purpose is to manage and debug the memory system (missions, templates, mental models, manual
  reflect runs, recall quality checks).
- The core retain/recall loop remains deterministic host/orchestrator behavior; it should not depend on the `memory` peer
  deciding what to do.

Retention strategy (v1):
- **Retain it all:** retain the **full conversation transcript** as a document with a stable `document_id` per session,
  letting Hindsight handle incremental updates (recent versions support “delta retain” that skips unchanged chunks).
- Enable **observations** by default so consolidation runs automatically after retain and produces durable learnings.
- Use `observation_scopes` to control what gets consolidated into “durable” observations (e.g., project-wide and per-agent),
  avoiding noisy per-session scopes unless explicitly desired.

Document ID + tags strategy (v1):
- Retain **one transcript document per agent session** (Coordinator + each peer), each with its own stable `document_id`.
- Tag each retained document with at least:
  - `project:<name>` (e.g., `project:pi-agent`)
  - `agent:<name>` (e.g., `agent:coder`)
  - `session:<id>` (per run/session identifier)
- Configure `observation_scopes` as `custom` so consolidation produces durable observations for:
  - `["project:<name>"]` and `["agent:<name>"]` scopes by default
  - not `["session:<id>"]` by default (keeps the learned layer clean)

LLM backend for Hindsight:
- Hindsight requires an LLM with structured output support for retain/reflect.
- Start by pointing Hindsight at our local vLLM OpenAI-compatible endpoint via `HINDSIGHT_API_LLM_PROVIDER=openai` and a
  custom base URL.
- Embeddings / reranking should default to local CPU-friendly models initially; v2 can move embeddings to a dedicated TEI
  server (separate process/service) without changing the agent runtime.
- Keep the option open to use a different (stronger) model/provider for memory extraction/reflection later via Hindsight’s
  per-operation LLM settings without changing the agent runtime.

## Consequences
Positive:
- Provides real long-term memory and learning primitives (retain/recall/reflect) without stuffing the full transcript into
  the model context window.
- Keeps the agent runtime thin: we can treat Hindsight as an external memory service behind a small interface.
- Supports iterative improvement: start conservative with what we retain and how we recall, then tighten over time.

Tradeoffs / Risks:
- Adds a new dependency/service to run and monitor (Hindsight + its storage).
- Memory quality depends on the LLM used for retain/reflect; `omnicoder-9b` may or may not be strong enough for robust
  extraction and reflection.
- Requires careful policy on what to retain (avoid leaking secrets, avoid storing noisy tool output verbatim).

Follow-ups:
- Add a “memory policy” section to the v1 spec (what to retain, what to redact, token budgets, and when to reflect).
- Decide bank + tagging scheme (single bank w/ tags).
- Decide initial “active recall” injection format (compact bullets, citations to artifacts, etc.).
- Decide how to run memory work “in the background” (dedicated `memory` peer vs host-side job queue calling Hindsight).
