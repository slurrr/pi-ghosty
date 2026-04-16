# Hindsight alignment implementation plan (revised)

## Objective
Align pi-ghosty with docs-only Hindsight best practices for pg0-first integration, with **pi extension mode** as the standard runtime path and **`pi-agent-canonical.json` as the only authoritative implementation config** until memory behavior is stabilized.

End state:
- Docs-aligned retain/recall behavior (and optional reflect) with conservative, quality-preserving defaults.
- Recall query shaping that uses Pi’s existing token estimation plumbing to stay within Hindsight’s query limits (with conservative headroom).
- Clear separation between pi-ghosty client config and Hindsight server (`HINDSIGHT_API_*`) config.
- Reference docs explicitly state branch-local Hindsight docs availability.

---

## Authoritative config policy (updated direction)

### Implementation target (authoritative)
- `pi-agent-canonical.json` is the only config file used for implementation changes.
- New memory keys, defaults, and acceptance tests are defined against canonical config only.

### Reference-only configs (non-authoritative for implementation)
- `pi-agent-local.json`
- `pi-agent-frontier.json`
- `pi-agent.json` and old runtime-precedence behavior

These remain documentation/reference examples until memory is stabilized.

### Runtime standard path
- **Pi extension mode is the standard path**.
- `GHOSTY_AGENT_CONFIG_PATH` should point to canonical config in normal workflows.

---

## Key constraints from upstream + repo evidence

1. Hindsight recall rejects queries above 500 tokens (`docs/Hindsight/skills/hindsight-docs/references/developer/api/recall.md`).
2. Current pi-coding-agent token helpers are estimation-based (chars/4 heuristic):
   - `estimateTokens()` in `@mariozechner/pi-coding-agent` compaction code is explicitly heuristic.
3. For this implementation, we will use Pi’s existing estimation approach (`estimateTokens()` / equivalent existing plumbing) rather than introducing a separate tokenizer dependency.
4. To respect Hindsight limits with an estimator, canonical defaults must keep conservative headroom below 500 tokens and enforce estimated-token bounding before recall calls.

---

## High-priority gaps to close

1. Canonical-only config policy not reflected in prior plan.
2. Extension-mode-first operating model not explicit enough.
3. Recall query shaping still framed around char bounds / heuristics.
4. Missing docs-aligned retain fields (`timestamp`, `update_mode`) and optional recall fields (`query_timestamp`, include/provenance).
5. Async operation handling remains fire-and-forget only.
6. Docs need branch-local upstream-source note consistency.

---

## Phase ordering (dependency-safe)

1. **Phase 0:** Docs/source-of-truth and policy reset (canonical-only + extension-first)
2. **Phase 1:** Canonical schema/config surface expansion
3. **Phase 2:** Recall query shaping via Pi token estimation implementation
4. **Phase 3:** Retain alignment (`timestamp`, `update_mode`)
5. **Phase 4:** Async operations reliability/observability
6. **Phase 5:** Reflect (gated, off-by-default)
7. **Phase 6:** Stabilization + reference-config sync notes

---

## Phase plan

## Phase 0 — Policy + docs reset (no runtime behavior changes)

### Goal
Make implementation governance explicit: canonical-only + extension-mode-first + branch-local upstream docs note.

### File targets
- `docs/reference/hindsight_alignment_implementation_plan.md`
- `docs/reference/hindsight_docs_only_pg0_best_practices.md`
- `docs/reference/hindsight_gap_analysis_vs_docs_only.md`
- `docs/reference/hindsight_best_practices_pg0.md`
- `docs/reference/hindsight_recommendation_report.md`

### Required updates
- Add explicit policy block in each relevant doc:
  - canonical is authoritative
  - local/frontier/legacy configs are reference-only until stabilization
  - extension mode is standard
- Add branch-local source note:
  - upstream docs under `docs/Hindsight/skills/...` are available on this branch; other checkouts may differ.
- Remove wording that implies implementation should keep parity across multiple runtime config files right now.

### Acceptance criteria
- All referenced docs agree on canonical-only + extension-first policy.
- No plan text suggests implementing new memory behavior primarily via local/frontier/legacy config files.

---

## Phase 1 — Canonical memory config surface completion

### Goal
Complete docs-aligned memory options in schema/load path, targeting canonical config only.

### File targets
- `src/config/schema.ts`
- `src/config/loadConfig.ts`
- `pi-agent-canonical.json`
- `.env.example` (extension/canonical usage examples only)

### Config additions (canonical-first)
Add/confirm in `defaults.memory.recall`:
- `maxTokens`
- `budget`
- `tagsMatch`
- `types`
- `maxFacts`
- `queryMaxTokens` (hard default <= 500, recommended 350-450 for conservative estimator headroom)
- `queryTimestampMode` (`now|message|session|custom`)
- `includeSourceFacts`
- `includeSourceFactsMaxTokens`
- `includeChunks`
- `includeChunksMaxTokens`
- `async`

Add/confirm in `defaults.memory.retain`:
- `context`
- `async`
- `timestampMode` (`now|message|session|none`)
- `updateMode` (`replace|append`)
- `observationScopes.*`
- `waitForCompletion`
- `waitTimeoutMs`

Add/confirm in `defaults.memory.operations`:
- `enabled`
- `pollIntervalMs`
- `timeoutMs`

Add/confirm in `defaults.memory.reflect` (gated):
- `enabled`
- `mode`
- `budget`

### Compatibility notes
- Keep parsing compatibility for legacy configs, but do not require new keys to be mirrored there.
- Canonical defaults should prioritize memory quality, not backward convenience.

### Acceptance criteria
- Typecheck passes.
- Canonical config fully expresses memory behavior knobs required by plan.
- Docs/examples show canonical as only implementation target.

---

## Phase 2 — Recall alignment with Pi token estimation (critical)

### Goal
Enforce Hindsight query-token limits using Pi’s existing token estimation plumbing (`estimateTokens()` / equivalent), with conservative guardrails.

### File targets
- `src/extensions/memoryExtension.ts`
- `src/memory/` (optional helper module, e.g. `recallQueryShape.ts`)
- `docs/reference/hindsight_best_practices_pg0.md`

### Implementation approach (required)
1. Use existing Pi token estimation utilities/plumbing to estimate query token length (no new tokenizer dependency).
2. Build recall query shaping pipeline:
   - derive concise query text from turn context
   - estimate token count via existing Pi approach
   - trim iteratively to `queryMaxTokens` estimated budget
3. Use conservative headroom in canonical defaults (well below 500) to compensate for estimator variance.
4. Keep optional `queryMaxChars` as secondary safety cap only.
5. Trace raw and final estimated token counts for auditability.

### Non-goal
- Do not add a separate tokenizer package or custom tokenization stack for recall shaping in this phase.

### Acceptance criteria
- Recall request builder enforces estimated query token count <= configured `queryMaxTokens` before API call.
- Canonical defaults include conservative headroom to reduce risk of server-side query-limit rejection.
- Validation shows no Hindsight 400 query-too-long errors in covered scenarios.

---

## Phase 3 — Retain API alignment

### Goal
Implement docs-aligned retain controls while preserving stable ID and safe defaults.

### File targets
- `src/extensions/memoryExtension.ts`
- `src/memory/hindsight.ts` (typed request wrappers, if needed)
- `docs/reference/hindsight_best_practices_pg0.md`

### Required changes
- Add `timestamp` emission per `retain.timestampMode`.
- Add `update_mode` support per `retain.updateMode`.
- Keep stable `document_id` behavior unchanged.
- Preserve durable observation scope defaults (project + agent) unless canonical overrides.

### Acceptance criteria
- Retain payload contains timestamp/update_mode when configured.
- Defaults remain stable and quality-oriented.
- No regressions in retain error handling.

---

## Phase 4 — Async operations reliability

### Goal
Support optional operation polling for environments requiring durability visibility.

### File targets
- `src/extensions/memoryExtension.ts`
- `src/memory/hindsight.ts`
- `docs/reference/hindsight_best_practices_pg0.md`

### Required changes
- If `operations.enabled` and async response includes operation ID:
  - poll operations endpoint until completion/failure/timeout
  - emit structured trace entries
- Respect `retain.waitForCompletion` and timeout config.
- Keep default non-blocking behavior for fast local loops unless explicitly enabled.

### Acceptance criteria
- Optional polling works and is observable.
- Timeout/failure is non-fatal to core agent flow.

---

## Phase 5 — Reflect integration (gated)

### Goal
Add reflect as an explicit, opt-in capability; keep default off.

### File targets
- `src/extensions/memoryExtension.ts`
- `src/config/schema.ts`
- `src/config/loadConfig.ts`
- `docs/decisions/0002-memory-hindsight.md`
- `docs/reference/hindsight_best_practices_pg0.md`

### Required changes
- Add manual reflect path first (no automatic background loop by default).
- Use canonical reflect config only.
- Add tracing + doc status updates.

### Acceptance criteria
- Reflect disabled by default.
- Manual reflect runs without impacting normal delegation loop.

---

## Phase 6 — Stabilization and reference-config synchronization

### Goal
After memory stabilization, document how/when reference configs should be updated.

### File targets
- `docs/reference/hindsight_alignment_implementation_plan.md`
- `docs/reference/hindsight_recommendation_report.md`
- `docs/reference/hindsight_gap_analysis_vs_docs_only.md`
- `pi-agent-local.json` (docs-only sync, not implementation driver)
- `pi-agent-frontier.json` (docs-only sync, not implementation driver)
- `pi-agent.json` (legacy note only)

### Required changes
- Mark stabilization checkpoint.
- Add explicit statement on whether reference configs are now synchronized from canonical or still frozen.

### Acceptance criteria
- No ambiguity about which file drives implementation.
- Reference files are clearly labeled as derived examples or legacy.

---

## Validation strategy (implementation phases)

### Mandatory checks
- `npm run typecheck`
- `npm run smoke:pi-ext`

### Memory validation matrix (extension-mode first)
1. Extension run with `GHOSTY_AGENT_CONFIG_PATH=./pi-agent-canonical.json`
2. Recall long-query cases:
   - verify estimate-based truncation keeps query under configured estimated-token budget
   - verify no 400 query-too-long errors from Hindsight
3. Retain timestamp/update mode cases
4. Async operation polling cases (enabled vs disabled)
5. Strict tag-match isolation cases (`all`, `any_strict`, `all_strict`)

---

## Milestones
- **M0:** Canonical-only + extension-first policy documented everywhere.
- **M1:** Canonical memory schema complete.
- **M2:** Estimate-based recall shaping complete.
- **M3:** Retain timestamp/update_mode complete.
- **M4:** Async operations support complete.
- **M5:** Reflect gated path complete.
- **M6:** Stabilization + reference-sync policy finalized.

---

## Risks and guardrails
- Do not let legacy/reference config parity block canonical improvements.
- Use Pi’s existing heuristic token estimates consistently, with conservative headroom in canonical defaults.
- Preserve strict-isolation defaults unless explicitly changed in canonical config.
- Keep memory optional/fault-tolerant (no hard failure of core flow on memory errors).

---

## Required doc note (to include in related references)

> **Branch-local source note:** Upstream Hindsight docs under `docs/Hindsight/skills/...` are available on this branch for alignment work. Other branches/checkouts may not include them. For implementation, `pi-agent-canonical.json` is the authoritative config target; `pi-agent-local.json`, `pi-agent-frontier.json`, and legacy runtime config paths are reference-only until memory stabilization.
