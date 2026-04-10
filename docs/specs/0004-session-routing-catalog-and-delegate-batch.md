# Spec: Session routing catalog + LLM enrichment + `delegate_batch`

## Problem
pi-ghosty currently keeps **one in-memory session per peer** (`coder`, `researcher`, `reviewer`, `memory`) and creates peers with `SessionManager.continueRecent(...)`, which effectively resumes “whatever was most recent”. This prevents:

- Running **multiple concurrent delegations** (e.g. 2 researchers in parallel)
- Maintaining multiple peer “context buckets” per peer role (threads/topics/projects)
- Human-like session management (resume the *right* session, start a new one when stale/bloated)

Additionally, deterministic filters like `cwd` are insufficient in practice (e.g. running pi-ghosty from `~` means many sessions share the same `cwd`), so routing requires **semantic understanding**.

## Goals
1. Add a coordinator tool `delegate_batch` to delegate **multiple requests concurrently** under a configurable concurrency limit.
2. Introduce a persistent **session catalog** (per peer) stored under the run directory.
3. Make session selection (resume/new/compact/retire) **stateful** and **human-like**.
4. Make semantic enrichment **mandatory** (not optional):
   - sessions are not eligible for routing unless they have an up-to-date semantic summary
   - routing decisions use an LLM call to choose the best session
5. Keep the coordinator’s mental model unchanged:
   - coordinator does not handle session IDs
   - coordinator continues to delegate by role (peerName) with `task/context/expectedOutput`

## Non-goals (v1)
- Embedding-based retrieval (vector search) for session selection
- Automatic cross-peer “project graphs” beyond per-peer catalogs
- Unlimited parallelism (bounded by GPU + vLLM); start small and explicit
- UI features for browsing sessions (optional future)

## Terms
- **Session**: a persisted pi session JSONL file managed by `SessionManager`.
- **Catalog**: the runtime-maintained index of sessions + metadata + semantic summary.
- **Routing**: choosing which session a request should run on (resume vs new, compact, retire).
- **Active session**: a session currently loaded in memory and/or executing (busy).

## User-facing behavior
- Coordinator gains a new tool: `delegate_batch`.
- Coordinator usage remains the same conceptually:
  - decide which peer(s) should work
  - provide a good delegation envelope
  - call `delegate_batch`
- The runtime will:
  - choose sessions behind the scenes
  - compact sessions when required by routing policy
  - create new sessions when required
  - update the session catalog

## Configuration
Add a routing configuration block to `pi-agent.json` defaults:

```jsonc
{
  "defaults": {
    "routing": {
      "maxParallelDelegations": 2,
      "maxNumSeqHint": 4,              // informational: matches vLLM max-num-seq
      "maxLoadedSessionsTotal": 8,     // in-memory cap; idle sessions are evicted (LRU)
      "maxLoadedSessionsPerPeer": 4,

      "compactThresholdPercent": 50,   // initial policy (tunable)
      "retireAfterCompactions": 3,

      "semantic": {
        "enabled": true,
        "updateCooldownMs": 300000,    // 5 min: throttle summary updates
        "maxCandidates": 12,
        "model": "default"            // v1: use same model as runtime unless overridden
      }
    }
  }
}
```

Notes:
- `compactThresholdPercent=50` is an initial proposed policy; expected to be tuned empirically.
- The semantic enrichment is mandatory in v1 (`enabled: true`).

## Tooling

### `delegate_batch` tool
A new coordinator-only tool.

**Input:**
```jsonc
{
  "requests": [
    {
      "peerName": "coder" | "researcher" | "reviewer" | "memory",
      "task": "...",
      "context": "...",           // optional
      "expectedOutput": "..."     // optional
    }
  ]
}
```

**Output:** an array of `PeerResult` objects (same shape as existing `delegate` result, but for each request), including the session identity actually used.

The coordinator does not provide or receive session IDs as inputs. Session IDs may appear in results for debugging/tracing, but should not be required for coordinator logic.

### Existing `delegate` tool
May remain for single-task delegation; internally it can be implemented via the same routing/scheduling pipeline.

## Persistent catalog

### Location
`<runDir>/data/session-catalog.json` (canonical)

### Shape (v1)
```ts
interface SessionCatalog {
  version: 1;
  projectTag: string;
  peers: Record<PeerName, CatalogEntry[]>;
}

type PeerName = "coder" | "researcher" | "reviewer" | "memory";

interface CatalogEntry {
  peerName: PeerName;
  sessionId: string;
  sessionFile: string;
  createdAt: string;       // ISO
  lastUsedAt: string;      // ISO

  // Hard metadata (deterministic)
  cwd: string;             // from session header
  stats?: {
    messageCount?: number;
    toolCalls?: number;
    contextPercent?: number | null; // null when unknown
    compactions?: number;
  };
  health?: {
    toolSpamSignals?: number;
    loopSignals?: number;
  };
  status?: {
    retired?: boolean;
    retireReason?: string;
  };

  // Soft metadata (LLM-enriched, mandatory)
  semantic: {
    title: string;
    summary: string;
    tags: string[];
    updatedAt: string;     // ISO
    source: "llm";
  };
}
```

### Catalog update rules (deterministic)
- On session creation: create a catalog entry immediately with required hard metadata and placeholder semantic (see enrichment).
- On `delegate_end`: update `lastUsedAt`, stats, and health counters.
- On compaction: increment compaction count in stats.
- On retire: set `status.retired=true` and preserve for inspection (do not delete by default).

## Mandatory semantic enrichment

### When semantic enrichment occurs
Semantic enrichment must occur:
1. When a session is created (immediately, before it becomes eligible for routing)
2. When routing needs it (missing semantic, stale semantic, or catalog entry newly imported)

Enrichment may be throttled by `updateCooldownMs`, but **semantic must exist** for all non-retired sessions.

### Enrichment inputs
The enrichment prompt should be built from:
- the delegation envelope (`task`, `context`, `expectedOutput`)
- the peer’s `peer_report.summary` (preferred) or last assistant text as fallback
- relevant deterministic metadata: peerName, projectTag, cwd

### Enrichment output (strict JSON)
```json
{
  "title": "...",
  "summary": "...",   
  "tags": ["..."]
}
```

Runtime validates output; on invalid output it retries once. If still invalid, the runtime must fall back to a safe minimal semantic object (e.g. title derived from task; summary = peer report summary) but should treat that session as “low confidence” for routing.

## Routing

### Candidate generation (deterministic)
Given `(peerName, request)`:
- Exclude retired sessions.
- Prefer sessions with matching `projectTag` (always available).
- `cwd` is advisory only (do not rely on it as primary key).
- Prefer sessions that are not busy.
- Prefer lower context usage and fewer compactions.
- Return at most `semantic.maxCandidates` candidates.

### LLM routing decision (mandatory)
For each request (including in `delegate_batch`), call an LLM router prompt with:
- the request
- candidate list (hard metadata + semantic summary only)
- routing rules

**Router output (strict JSON):**
```json
{
  "action": "resume" | "new" | "compact_then_resume",
  "sessionId": "..." ,
  "reason": "...",
  "confidence": 0.0
}
```

Validation:
- If `action` requires `sessionId` but it is missing/unknown: retry once.
- If still invalid: choose `new` deterministically.

### Compaction policy
- If a chosen session’s `contextPercent` is known and `>= compactThresholdPercent`, routing must choose `compact_then_resume` (or `new` if compaction is not viable).
- If context percent is unknown (`null`), fall back to message-count and tool-spam heuristics.

### Retirement policy
- If `compactions >= retireAfterCompactions`, mark session retired.
- Retired sessions are excluded from automatic routing but remain inspectable in the catalog.

## Concurrency and scheduling

### Global concurrency limit
- Enforce `maxParallelDelegations` across all peers and sessions.
- Initial default: `2`.

### Per-session mutual exclusion
- Never call `prompt(...)` concurrently on the same loaded session.
- If two requests route to the same session, they must queue.

### Parallel sessions of the same peer
- Supported: the router can choose two distinct sessions for two requests both targeting `coder`.
- If no suitable second session exists, router chooses `new` for one of the requests.

## Observability / tracing
Add runtime trace events (JSONL) under existing traces:
- `session_catalog_loaded` (version, counts)
- `session_catalog_updated` (sessionId, fields changed)
- `session_semantic_enrich_start/end` (sessionId, success, duration)
- `session_route_decision` (peerName, action, chosenSessionId, confidence)
- `delegate_batch_start/end` (request count, parallelism, durations)

## Acceptance criteria
- Coordinator can delegate two requests concurrently via `delegate_batch`.
- Peers can run concurrently (including two sessions of the same peer role).
- Routing does not rely on `cwd` for correctness; semantic summaries and projectTag drive selection.
- Every non-retired catalog entry has semantic `title/summary/tags`.
- Sessions above `compactThresholdPercent` are compacted before reuse (or replaced with new).
- After `retireAfterCompactions`, sessions are retired and excluded from auto-routing.

## V1 notes (accepted limitations)
These are known gaps/choices that are acceptable for v1 and may be revisited:

- **Busy-session avoidance is optional**: the router may route multiple requests to the same “best” session. A per-session mutex will serialize execution. This is acceptable when reuse of the best context bucket is preferred over maximum parallelism.
- **`semantic.model` config is forward-looking**: config may expose a separate model for routing/enrichment, but v1 may use the default runtime model for all router/enrichment calls.
- **Semantic eligibility is minimal**: v1 considers a session “eligible” once it has a semantic `{title, summary, tags}` and is not retired; staleness is primarily governed by `updateCooldownMs` rather than deep semantic drift detection.

## Implementation sketch (non-binding)
- Introduce `SessionCatalogStore` (read/write JSON + atomic update).
- Introduce `SessionPool` (load/open/create sessions on demand; LRU eviction of idle sessions).
- Implement `Router`:
  - deterministic candidate selection
  - LLM routing decision (strict JSON + validation)
  - compaction/retire enforcement
- Add `delegate_batch` tool:
  - schedules N routed delegations with global semaphore + per-session locks
  - returns array results.
