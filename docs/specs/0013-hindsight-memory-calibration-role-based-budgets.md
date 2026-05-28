# Spec: Hindsight Memory Calibration (Role-Based Token Budgets)

## Problem
`pi-ghosty` memory injection currently relies on a blunt `maxFacts` truncation (e.g. 60 facts injected for the corroborator). This ignores token density, role intent, and Hindsight’s documented retrieval tuning. The result is either:

- **Robot brain**: too many observations injected, drowning the corroborator in noise.
- **Context starvation**: workers sometimes lack the detailed, source-grounded context needed for technical accuracy.

We need a **role-based** (and optionally task-tiered) recall budget system that is:
- token-budgeted (primary limiter)
- bank-aware (personal vs procedural)
- optionally provenance-aware (source facts)
- optionally chunk-aware (raw code/text snippets)
- easy to tune without rewriting code

## Scope
In scope:
- Replace `maxFacts`-based truncation with **token budgets** in the Hindsight recall request.
- Add `memoryProfiles` so different agent roles can inherit different budgets.
- Define initial numeric budgets for:
  - corroborator (focused, low-noise)
  - worker (technical / comprehensive; doc-aligned defaults)

Out of scope (this spec):
- Any server-side changes to Hindsight or the vLLM memory backend.
- New evaluation harnesses.
- Changes to retain `append` semantics (append continuity is assumed already fixed).
- Automatic dynamic budget scaling per model context window.

## Requirements

### R1. Role-based memory profiles
Add a `defaults.memoryProfiles` config block, and allow each agent to select a profile via `agent.memoryProfile`.

Resolution order for effective config MUST be:
1) global defaults (`defaults.memory.*`)
2) selected profile (`defaults.memoryProfiles[agent.memoryProfile]`)
3) agent-specific overrides (`agents[].memory.*`)

### R2. Token budgets are the primary limiter
Recall configuration MUST be expressed primarily in tokens, not counts.

`maxFacts` truncation MUST be removed from the recall pipeline.

A future "belt-and-suspenders" hard cap (e.g. `maxFacts`) may be added later if needed, but is not required for initial implementation.

### R3. Bank-aware budgets (REQUIRED for v1)
Recall MUST support independent token budgets for:
- personal bank
- procedural bank

Disabling a bank MUST be possible by setting its max tokens to `0`.

This is a v1 requirement: the corroborator MUST be able to use a different max token cap for personal vs procedural recall.

### R4. Source facts budget (provenance)
Recall MUST support a dedicated token budget for source facts / provenance (where supported by Hindsight recall).

### R5. Chunks budget (raw excerpts)
Recall MUST support a dedicated token budget for chunks (raw text/code snippets). Disabling chunks MUST be possible by setting it to `0`.

### R6. Search depth / retrieval budget
Recall MUST support a role-tunable retrieval depth parameter (`budget`: low/mid/high), aligned with Hindsight documentation.

## Proposed Profiles (Initial Numbers)
These are initial defaults meant to be tuned in practice.

### Profile: `corroborator` (narrative / focused / low-noise)
Goal: big-picture continuity without technical clutter.

LOCKED (v1):

- `budget`: `mid`
- Per-bank max tokens (applied to the *separate* recall calls):
  - `bankMaxTokens.personal`: **1536**
  - `bankMaxTokens.procedural`: **1024**
- `includeSourceFacts`: true
- `includeSourceFactsMaxTokens`: **256**
- `includeChunks`: false
- `includeChunksMaxTokens`: **0** (disabled)
- Total target (informational): **3072** (= 1536 + 1024 + 256)

Notes:
- 3072 is intentionally above the “focused 2048” floor to avoid lobotomizing continuity, while still preventing the 60-fact wall-of-text.

### Profile: `worker` (technical / comprehensive; doc-aligned defaults)
Goal: high-resolution technical accuracy (workers are not user-facing).

Use Hindsight doc-aligned “comprehensive” defaults to start, then tune after real usage.

- `budget`: `high`
- Per-bank max tokens:
  - `bankMaxTokens.personal`: **0** (disabled)
  - `bankMaxTokens.procedural`: **8192**
- `includeSourceFacts`: true
- `includeSourceFactsMaxTokens`: **4096**
- `includeChunks`: true
- `includeChunksMaxTokens`: **8192**

Notes:
- Workers only query the procedural bank today (`memoryExtension.ts` selects both banks only for `corroborator`). Setting `bankMaxTokens.personal=0` makes the intent explicit.
- Even though `bankMaxTokens.procedural` is 8192, Hindsight may return fewer tokens depending on availability and retrieval.

Notes:
- This intentionally mirrors the Hindsight defaults/ceilings described in the peer research (chunks 8192, source facts 4096) so we start from “ground truth” and tune downward only if needed.

## V2 note: multiple worker presets / tiering
Out of scope for v1, but the profile system should be shaped so we can later add:
- `worker` vs `worker_deep` profiles
- per-delegation or per-task promotion to `worker_deep`

## Implementation Plan

### I1. Schema changes (`lib/config/schema.ts`)
- Add `defaults.memoryProfiles: Record<string, MemoryProfile>`.
- Add `agents[].memoryProfile?: string`.

Add per-bank recall max tokens to the *client* recall config (these are used to set the `maxTokens` argument on each `hindsight.recall()` call):
- `memory.recall.bankMaxTokens.personal: number` (0 disables)
- `memory.recall.bankMaxTokens.procedural: number` (0 disables)

Also keep existing recall boolean gates and max-token caps (already present today):
- `memory.recall.includeSourceFacts` + `memory.recall.includeSourceFactsMaxTokens`
- `memory.recall.includeChunks` + `memory.recall.includeChunksMaxTokens`

Align to existing naming:
- keep/continue using existing `memory.recall.budget` (low|mid|high)
- keep/continue using existing `includeSourceFacts`, `includeSourceFactsMaxTokens`
- keep/continue using existing `includeChunks`, `includeChunksMaxTokens`

Deprecation note:
- keep `memory.recall.maxFacts` in schema for now, but it will no longer be applied in the injection pipeline.

### I2. Effective config resolution (`lib/extensions/memoryExtension.ts`)
Today `memoryExtensionFactory()` only uses `config.defaults.memory.*` (e.g. `const recallCfg = memoryDefaults.recall;`).

Implement effective memory config resolution inside `memoryExtensionFactory()`:
- start with `config.defaults.memory`
- if the current agent has `memoryProfile`, merge `config.defaults.memoryProfiles[memoryProfile]`
- merge any agent-specific memory override block (if present in config)

Use the resolved config to set:
- `recallCfg`
- `retainCfg`
- `operationsCfg`

Log the resolved effective recall configuration at low volume (e.g. once per agent start).

### I3. Recall request construction (`lib/extensions/memoryExtension.ts`)
- Remove `facts.slice(0, recallCfg.maxFacts)` truncation.
- For each recall target (personal/procedural), set `maxTokens` per call from the new per-bank config:
  - `maxTokens = recallCfg.bankMaxTokens[target.role]`
  - if `maxTokens` is 0, skip calling Hindsight for that bank.
- Continue passing:
  - `budget: recallCfg.budget`
  - `includeSourceFacts` + `includeSourceFactsMaxTokens`
  - `includeChunks` + `includeChunksMaxTokens`

Important: the per-bank token limit is a *client-side* limiter expressed by setting `maxTokens` on the Hindsight recall request; it must differ between personal and procedural for corroborator.

### I4. Configure profiles in `pi-agent.json`
- Add the two profiles under `defaults.memoryProfiles` (`corroborator`, `worker`).
- Assign corroborator `memoryProfile: corroborator`.
- Assign worker agents `memoryProfile: worker`.

## Constraints
- Keep the change minimal and reversible.
- Avoid introducing a complex tuning DSL.
- Preserve existing behavior when profiles are not configured (migration safety): fall back to `config.defaults.memory.*` when `agent.memoryProfile` is not set or unknown.

## Acceptance Criteria
- Corroborator injection is token-budgeted and materially less noisy than the current 60-fact injection.
- Worker injection uses doc-aligned comprehensive budgets (chunks + source facts) and yields sufficient grounding for technical decisions.
- Token budgets (and bank disables) are visible and auditable via logs.
- No regression in Hindsight recall call stability.

## Decisions (Locked)
- Migration behavior (v1): **fallback is allowed**. If `agent.memoryProfile` is missing (or profile name is unknown), use existing `config.defaults.memory.*` behavior.
- Belt-and-suspenders (v1): **keep `maxFacts` in schema/config for now, but do not apply it by default** once token budgets are live.
  - Rationale: v1 should be token-first.
  - If needed later, we can re-introduce a *profile-specific* hard cap without changing the schema.

## V2 notes
- If workers still need better ergonomics, add multiple worker presets (e.g. `worker_deep`) and/or per-delegation promotion.
