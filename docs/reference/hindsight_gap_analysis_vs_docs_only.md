# Gap analysis: docs-only pg0 best practices vs current pi-ghosty Hindsight implementation

Goal: compare **`docs/reference/hindsight_docs_only_pg0_best_practices.md`** (docs-led, implementation-agnostic) against **current pi-ghosty code/config**, and list meaningful gaps (implementation, config surface, docs correctness). Prioritize by impact.

Reviewed sources:
- Docs-only reference: `docs/reference/hindsight_docs_only_pg0_best_practices.md`
- Current memory extension: `src/extensions/memoryExtension.ts`
- Memory config schema: `src/config/schema.ts`
- Config normalization + precedence: `src/config/loadConfig.ts`
- Env defaults: `src/env.ts`
- Example configs: `pi-agent-canonical.json`, `pi-agent-local.json`, `pi-agent-frontier.json`, `pi-agent.json`
- Supporting internal docs: `docs/reference/hindsight_best_practices_pg0.md`, `docs/reference/hindsight_current_implementation.md`, `docs/reference/hindsight_recommendation_report.md`

---

## 1) Summary

The docs-only reference captures many upstream Hindsight concepts (banks, tags, retain/recall/observations/reflect, pg0 vs Postgres) and several recommendations are already matched by pi-ghosty (stable `document_id`, `context`, strict tag filtering, durable observation scopes).

However, relative to current pi-ghosty:

- It assumes access to upstream Hindsight docs under `docs/Hindsight/skills/hindsight-docs/references/**`. On this branch those files are present and should be treated as the primary upstream source for server/API behavior; in other checkouts they may be missing depending on repo history/ignore rules.
- It recommends numerous Hindsight API features that **pi-ghosty doesn’t currently use or expose** (timestamps, update_mode append, query_timestamp, operations polling, include options, entity labels/directives, reflect loop integration).
- It does not map recommendations to the **actual pi-ghosty config surface** that now exists (`defaults.memory.*`), which is the primary way operators tune recall/retain in this repo.

---

## 2) What we already do well (matches docs-only guidance)

### A) Stable `document_id` for idempotence/upserts

Docs-only: stable IDs enable upsert; don’t use random UUIDs.

Implementation: retain uses
- `document_id = ${projectTag}/${agentName}/${sessionId}` (`src/extensions/memoryExtension.ts`).

### B) `context` is always set for retain

Docs-only: `context` is high-impact; always set it.

Implementation: retain sends `context` from config (default `"pi-ghosty agent session transcript"`) (`src/config/schema.ts`, used in `src/extensions/memoryExtension.ts`).

### C) Strict tag isolation stance by default

Docs-only: strict tags matching recommended for safety in shared banks.

Implementation:
- recall tags are `[projectTag, agent:<agentName>]`
- default `tagsMatch` is `"all"` (`src/config/schema.ts`, used in `src/extensions/memoryExtension.ts`).

This is strict and prevents cross-agent leakage in a shared bank.

### D) Observations are used as the durable consolidation mechanism (via retain)

Docs-only: observations are default always-on learning; define scopes.

Implementation: retain sets `observation_scopes` with durable scopes via config toggles (default: project+agent, not session) (`src/extensions/memoryExtension.ts`, `src/config/schema.ts`).

### E) Recall payload is bounded

Docs-only: set `budget` + `max_tokens`.

Implementation: recall uses `max_tokens` and `budget` configurable via `defaults.memory.recall` (defaults 2048 + "mid") (`src/config/schema.ts`, `src/extensions/memoryExtension.ts`).

### F) Operational safety: memory is best-effort and failure-tolerant

Implementation catches errors for recall and retain and continues without memory (`src/extensions/memoryExtension.ts`). This aligns with docs-only guidance to avoid coupling core correctness to memory availability.

---

## 3) High-impact gaps (P0 / P1)

### P0 — Upstream-docs location must be treated as branch-local source-of-truth

Docs-only doc asserts it is derived from upstream Hindsight documentation shipped in-repo under `docs/Hindsight/skills/hindsight-docs/references/**`.

Reality:
- On **this branch**, those upstream docs are present and should be used as the source of truth for Hindsight server/API semantics.
- In other checkouts/branches, those files may be absent depending on ignore/history; alignment work must make that branch-local assumption explicit.

Impact:
- Without an explicit note, readers may think the upstream docs are always present or may distrust citations if they can’t find the files.

Action:
- Add a consistent header note to alignment docs stating where upstream Hindsight docs live on this branch and that `HINDSIGHT_API_*` knobs are server-side.

### P0 — Recall query shaping: docs warn about max query tokens; pi-ghosty only truncates by chars (optional)

Docs-only: server rejects queries over `HINDSIGHT_API_RECALL_MAX_QUERY_TOKENS` (default 500 tokens) and recommends query shaping.

Implementation:
- query is `event.prompt` truncated by `defaults.memory.recall.queryMaxChars` if set; otherwise unbounded (`src/extensions/memoryExtension.ts`, `src/config/schema.ts`).

Gaps:
- Char-limit ≠ token-limit; long prompts can still exceed the server’s token limit depending on language/content.
- Default `queryMaxChars` is unset, so **by default** we can still send very large prompts.

Action:
- Set a default `queryMaxChars` in canonical config (e.g., 4000–8000 chars) or implement token-aware shaping.

### P1 — Missing timestamps on retain (temporal retrieval weakened)

Docs-only: timestamps are important; missing timestamps disables temporal ranking.

Implementation:
- Retain does not send `timestamp` at all (`src/extensions/memoryExtension.ts`).

Impact:
- Hindsight will likely assign ingestion time, but conversation event timing may not be preserved if messages include historical events.

Action:
- Add an optional timestamp field (if available from pi event/session), or document explicitly that “retain timestamp is ingestion time only” in pi-ghosty.

### P1 — Missing `update_mode=append` / delta retain semantics

Docs-only recommends using `append` for growing logs/chats and notes delta retain.

Implementation:
- Retain is only sent at `agent_end`, and no `update_mode` is specified.

Impact:
- If sessions are long and you ever move retain earlier (per turn), you’ll want update_mode control to avoid constant replaces.

Action:
- Either (a) keep end-of-session retain and state that `append` is not needed, or (b) expose `update_mode` in `defaults.memory.retain` for future per-turn retain.

---

## 4) Medium-impact gaps (P2)

### P2 — Async operations & operations polling are not integrated

Docs-only: async retain returns `operation_id` and can be polled via operations API; batch retain cost savings may depend on async.

Implementation:
- Recall always passes `async: true` (hard-coded) and retain passes `async: retainCfg.async`, but the return value is ignored.
- There is no operations polling or “eventual completion” tracking.

Impact:
- If async is truly async server-side, pi-ghosty has no way to know retain completed; recall quality may lag behind new retains.

Action:
- Decide whether to treat async as “fire and forget” (current behavior) and document it, or add an optional operations polling step for reliability/diagnostics.

### P2 — Reflect is described extensively, but pi-ghosty does not use it

Docs-only: reflect is a separate loop; missions/dispositions/directives matter.

Implementation: reflect not wired (`src/extensions/memoryExtension.ts`).

Impact:
- Docs-only doc may lead readers to expect reflect behavior from pi-ghosty.

Action:
- Add a prominent note: “pi-ghosty currently does not call reflect; relies on observations + recall injection.”

### P2 — Include/provenance options not supported/exposed

Docs-only: recall can include chunks/provenance; helpful for auditing.

Implementation:
- recall only pulls `facts`/`results` and injects `f.text` bullets.
- no include flags, no provenance/citations.

Impact:
- Hard to debug why a memory was recalled; harder to quote sources.

Action:
- Add an optional debug mode that requests/prints provenance in traces (not necessarily in system prompt).

---

## 5) Lower-impact gaps / mismatches (P3)

### P3 — Entity labels / directives are not part of pi-ghosty config

Docs-only recommends controlled label sets and directives for hard rules.

Current pi-ghosty scope: no bank config management in client; only tags + observation scopes.

Action:
- Keep out of v1 unless there’s a concrete need; if added, prefer configuring on the Hindsight server/bank rather than pi-ghosty.

### P3 — “pg0 storage path” and other server-side env details are not actionable here

Docs-only claims pg0 path defaults etc.

pi-ghosty doesn’t launch the server; only configures client. These belong in a **server deployment doc** (or a separate repo).

Action:
- In pi-ghosty docs, clearly separate “client config” vs “Hindsight API/server config”.

---

## 6) Implementation/config surface gaps (what to add/remove in pi-ghosty)

### Add (high leverage)

1) **Default query bounding**
   - Set `defaults.memory.recall.queryMaxChars` in `pi-agent-canonical.json` (and mention it in docs). This directly implements docs-only “keep queries small” guidance.

2) **Optional multi-tenant strict modes in docs**
   - The schema already supports `any_strict` and `all_strict` (`src/config/schema.ts`). Document when to use them.

3) **Optional timestamp support**
   - If pi provides timestamps, thread them into retain options; otherwise add a doc note.

### Remove/adjust (docs)

1) In `hindsight_docs_only_pg0_best_practices.md`, fix the “Sources (primary)” section to avoid pointing to missing `docs/Hindsight/...` paths.
2) Add an explicit “pi-ghosty status” section that says which of the docs-only recommended fields are currently implemented:
   - Implemented: tags, tags_match, types, max_tokens, budget, context, observation_scopes.
   - Not implemented: timestamp, update_mode, query_timestamp, include options, operations polling, reflect.

---

## 7) Priority recommendations (ordered)

### P0
- Fix the docs-only doc’s source claims (either vendor upstream docs into this repo or remove the references).
- Ensure recall queries are bounded by default (set `queryMaxChars` in canonical config and document why).

### P1
- Decide whether to add timestamps to retain; if not, document the limitation.
- Decide whether the project intends per-turn retain in future; if yes, plan for `update_mode`/delta retain.

### P2
- Add docs clarifying reflect is not wired and async operations are fire-and-forget.
- Consider adding a debug/provenance mode for recall traces.

---

## 8) Quick “match/mismatch” table

| Docs-only recommendation | pi-ghosty status | Evidence |
|---|---|---|
| stable `document_id` | ✅ implemented | `src/extensions/memoryExtension.ts` |
| always set `context` | ✅ implemented | `src/config/schema.ts`, `src/extensions/memoryExtension.ts` |
| strict `tags_match` in shared banks | ✅ default strict | `tagsMatch: all` default in `src/config/schema.ts` |
| observation scopes explicit | ✅ implemented | `retain.observationScopes` toggles + `observation_scopes` in retain |
| keep recall query small | ⚠️ optional only | `queryMaxChars` exists but default unset |
| send timestamps | ❌ not implemented | retain options omit timestamp |
| use `update_mode=append` for journals | ❌ not implemented | retain options omit update_mode |
| support `query_timestamp` | ❌ not implemented | recall options omit query_timestamp |
| async operations w/ polling | ❌ not implemented | no operation handling |
| reflect integration | ❌ not wired | comment in `src/extensions/memoryExtension.ts` |

