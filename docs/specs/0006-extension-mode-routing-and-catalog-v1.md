# Spec: Extension-mode session routing + catalog v1 (ghosty)

## Problem
Extension mode (`.pi/extensions/ghosty/index.ts`) currently provides a working but **slim** session routing + cataloging path:

- It persists sessions per peer and keeps a simple catalog (`SessionCatalogStore`).
- It routes mostly by recency and uses an LLM call to decide resume/new when there are multiple candidates.

However, the legacy runtime (`src/runtime/*`) already solved several stability and operability concerns (deterministic router behavior, better candidate filtering, caps/eviction, delta-based semantic refresh, trace events). We want to **port the robust parts** into extension mode without reintroducing legacy-only coupling.

## Goals (v1)
1. Make extension-mode routing **deterministic and debuggable**.
2. Improve catalog metadata so routing decisions are more stable (less “resume random recent”).
3. Add **drift/weather** fields as bounded, LLM-owned metadata (reference-only in v1).
4. Ensure concurrency safety: prevent two delegations from racing on the same peer session.
5. Keep v1 minimal: routing chooses **resume vs new** only.

## Non-goals (v1)
- No model switching within a session.
- Routing does not adjust thinking levels or sampling per task.
- No auto-retire driven by LLM; no “quality review workflows”.
- No per-turn retain/recall policy changes (memory system is out of scope).
- No UI session browser requirements.

## Constraints / decisions
- **Session model is stable for the life of the session.** Routing does not switch model.
- **`request.model` is ignored/removed** from the routing API contract.
- Drift/weather is “soft metadata”: bounded schema, used only as advisory in v1.

---

## Current extension state (brief)

Implementation:
- `.pi/extensions/ghosty/index.ts`

Key behaviors:
- Uses `SessionCatalogStore(runDir, projectTag)` persisted under `<runDir>/data/session-catalog.json`.
- Routing function `routePeerSession(peerName, request, ctx)`:
  - lists sessions under `<runDir>/data/sessions/<peerName>/`
  - builds candidate list from catalog (filters retired)
  - sorts primarily by `lastUsedAt`
  - optionally asks an LLM router to choose resume/new
- Semantic enrichment `maybeEnrichSemantic(entry, request, reportSummary, ctx)`:
  - time-based refresh only (cooldown)
  - stores `semantic.title/summary/tags`

---

## Proposed v1 design

### 1) Deterministic routing pipeline

Routing is a two-stage pipeline:

1) **Deterministic prefilter** (hard constraints, no LLM):
   - Exclude retired sessions.
   - Exclude busy sessions.
   - Prefer sessions with lower context usage and fewer compactions.
   - Prefer more recently used sessions after applying “health” filters.
   - Cap to `routing.semantic.maxCandidates`.

2) **LLM routing decision** (strict JSON, bounded output):
   - Output schema:
     ```json
     {"action":"resume"|"new","sessionId":"optional","reason":"...","confidence":0.0}
     ```
   - Validation rules:
     - If `action="resume"` but `sessionId` missing/unknown → retry once.
     - If still invalid → deterministically choose `new`.

> Future hook (not v1): allow `compact_then_resume` as an action when the deterministic prefilter determines context is too high.

### 2) Dedicated router/semantic model selection (decoupled from ctx.model)

Extension mode should not rely on whatever interactive model the user currently selected (`ctx.model`) for routing/semantic calls.

Add a **config-driven router model spec**:

- `defaults.routing.semantic.model`: string preset/scope key (existing in config design)
- v1 behavior:
  - Try to resolve a router model deterministically from config.
  - If resolution fails, fall back to `ctx.model`.

Requirements:
- Router calls must be **stateless**, short, and deterministic:
  - temperature 0
  - strict JSON response_format
  - disable “thinking” at template layer when available
  - hard timeout (e.g. 30s)

### 3) Catalog schema additions (weather/drift)

We extend `CatalogEntry` with a bounded “weather” structure. This is LLM-authored metadata derived from:

- routing request envelope (task/context/expectedOutput)
- latest peer_report summary (preferred)
- deterministic stats deltas

**New fields (v1):**

```ts
interface CatalogEntry {
  // existing fields ...

  semantic: {
    // existing fields ...

    // Weather/drift: LLM-owned, bounded.
    weather?: {
      state: "good" | "drifting" | "stale";
      driftScore: number; // 0..1
      reason: string;     // <= 1 sentence
      updatedAt: string;  // ISO
      authority: {
        level: "advisory"; // v1 fixed
      };
    };
  };
}
```

**Meaning:**
- `state=good`: session semantics aligned; safe to resume.
- `state=drifting`: still usable but may be topic-shifted / mixed.
- `state=stale`: semantic summary likely inaccurate.

**Authority curve (v1):**
- weather is **advisory only**.
- it can influence routing as a small penalty (tie-breaker) but cannot force retirement.

### 4) Weather/drift update triggers (v1)

Weather should update when:

- semantic metadata refresh runs (time or delta-triggered)
- a delegation completes (we have fresh peer_report)

Update policy:
- Start conservative: driftScore thresholds high.
  - e.g. `drifting` only if `driftScore >= 0.7`
  - `stale` only if `driftScore >= 0.9`

### 5) Semantic refresh: time + delta triggers

Port delta-based triggers from legacy runtime:

- Refresh semantic if **any**:
  - `now - semantic.updatedAt > updateCooldownMs`
  - `compactions` increased
  - `messageCount` increased by N (e.g. 50)
  - `toolCalls` increased by M (e.g. 15)

This is still “LLM-owned” content, but trigger evaluation is deterministic.

### 6) Concurrency safety

Add a per-session mutex keyed by `sessionId`:

- Any delegation that targets a given `peerSessionId` must run under `mutex(peerSessionId)`.
- Maintain a `busySessionIds` set:
  - routing prefilter should avoid busy sessions when alternatives exist
  - if all sessions are busy and `maxLoadedSessionsPerPeer` is hit, create new session

### 7) Session caps and eviction (minimal)

Port (or reimplement) a minimal `SessionPool` behavior:

- Keep handles for loaded sessions.
- Enforce:
  - `maxLoadedSessionsTotal`
  - `maxLoadedSessionsPerPeer`
- Evict least-recently-touched sessions that are not busy.

No retirement in v1.

### 8) Observability / tracing

Add runtime JSONL events for:

- `session_catalog_loaded` (counts by peer)
- `session_catalog_updated` (fields list)
- `session_semantic_enrich_start/end/error/invalid_json`
- `session_route_start/decision/error`
  - include candidates count, filtered reasons, chosen action/sessionId, confidence
- `delegate_start/end`
  - include peerName, peerSessionId, sessionState, elapsedMs

Tracing should be best-effort and must not fail routing.

---

## Routing prompt contract (v1)

The router prompt must be short and operate over a bounded candidate list.

Inputs:
- `request.task`, `request.context`, `request.expectedOutput`
- candidate list (per session):
  - sessionId, lastUsedAt, cwd
  - stats: messageCount, toolCalls, contextPercent, compactions
  - semantic: title, summary, tags
  - semantic.weather (if present)

Output:
```json
{"action":"resume"|"new","sessionId":"optional","reason":"...","confidence":0.0}
```

Validation:
- If resume chosen but sessionId invalid → retry once.
- Else fall back to deterministic new.

---

## Migration / compatibility

- Existing session catalog files should continue to load.
- New optional fields (`semantic.weather`) default absent.
- Extension routing should tolerate missing stats fields.

---

## Future extensions (explicitly out of v1)

- `compact_then_resume` routing action.
- Auto-retire with strong guardrails + explicit human approval.
- Entity-label-driven session clustering.
- Multiple router models per peer type.
- Dedicated UI for browsing sessions.
