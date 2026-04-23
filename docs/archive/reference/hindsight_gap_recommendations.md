# Gap & recommendations report: `hindsight_best_practices_pg0.md` vs current pi-ghosty implementation/config

Scope: verify that the new best-practices doc matches **current code + config surface**, identify contradictions/unsafe defaults, and recommend concrete fixes for local-only / hybrid / frontier.

Reviewed artifacts and code:
- Best practices doc: `docs/reference/hindsight_best_practices_pg0.md`
- Serving-mode recommendations: `docs/reference/hindsight_recommendation_report.md`
- Current implementation: `src/extensions/memoryExtension.ts`
- Config schema + normalization: `src/config/schema.ts`, `src/config/loadConfig.ts`
- Config files: `pi-agent-canonical.json`, `pi-agent-local.json`, `pi-agent-frontier.json`, `pi-agent.json`

---

## 1) Summary verdict

The best-practices doc is partially aligned with the **memory semantics** (retain transcript, recall tag filtering, observations at durable scopes), but it is **not repo-grounded** in two critical areas:

1) It references an `agentmux` backend that is **not present in this repo** (no `agentmux/**` paths exist in the current checkout), while claiming to be repo-grounded.
2) It does not reflect the **newly added pi-ghosty config surface** for memory defaults (`defaults.memory.*`) that now directly controls recall/retain behavior in `src/extensions/memoryExtension.ts`.

Net: the doc is useful as “general operational guidance”, but it currently risks misleading readers about *what they can configure in pi-ghosty today*.

---

## 2) Concrete gaps / mismatches

### Gap A — Nonexistent backend references (agentmux)

`docs/reference/hindsight_best_practices_pg0.md` cites numerous files under `agentmux/...` (runner, scripts, mux examples) as if present.

- In the current repo, there is **no** `agentmux/` directory (search returns none).

Impact:
- Readers can’t follow citations or reproduce the launch pattern.
- Recommendations about derived env (`HINDSIGHT_LLM_PROVIDER` hard-coded, etc.) are unverifiable and may be stale.

### Gap B — Doc doesn’t reflect current **configurable** memory settings

Since the latest config changes, recall/retain behavior is no longer “fixed constants”; it is driven by `config.defaults.memory` (`src/extensions/memoryExtension.ts`).

Current config knobs (schema):
- Recall: `defaults.memory.recall.{ maxTokens, budget, tagsMatch, types, maxFacts, queryMaxChars }` (`src/config/schema.ts`).
- Retain: `defaults.memory.retain.{ context, async, observationScopes.{ includeProjectScope, includeAgentScope, includeSessionScope } }` (`src/config/schema.ts`).

The best-practices doc still describes hard-coded behavior (“max 2048 tokens”, “inject up to 30”) without pointing to these settings or the canonical config location (`pi-agent-canonical.json`).

Impact:
- Operators may incorrectly assume they must patch code to tune recall/retain.

### Gap C — Serving-mode doc vs best-practices doc: drift on “what belongs where”

`hindsight_recommendation_report.md` correctly separates:
- pi-ghosty client knobs (`HINDSIGHT_BASE_URL`, `HINDSIGHT_BANK_ID`, `PROJECT_TAG`) from
- Hindsight API knobs (`HINDSIGHT_API_*`).

The best-practices doc mixes these but does not clearly state that **pi-ghosty only reads** the client knobs and memory defaults from its config.

Impact:
- Misconfiguration risk (setting `HINDSIGHT_API_*` in pi-ghosty env and expecting effect).

### Gap D — Local-only/hybrid/frontier examples don’t map to the repo’s config files

- The repo now has:
  - `pi-agent-canonical.json` (new-style: `defaults.runtime`, `defaults.memory`)
  - `pi-agent-local.json` (legacy-style keys at `defaults.hindsightBaseUrl` etc; still supported via normalization in `src/config/loadConfig.ts`)
  - `pi-agent-frontier.json` (does **not** define runtime; relies on env or other config)

Best-practices doc doesn’t mention:
- which file is loaded by default (`loadConfig()` prefers canonical first; `src/config/loadConfig.ts`)
- that legacy keys are normalized
- that `pi-agent-frontier.json` alone won’t set runtime endpoints

Impact:
- Frontier/hybrid operators may edit the wrong file and see no effect.

### Gap E — Safety: implied “localhost” vs “127.0.0.1”

- Best-practices doc recommends binding to `127.0.0.1`.
- Code defaults use `http://localhost:8888` if env/config not set (`src/extensions/memoryExtension.ts` fallback).

Impact:
- Minor but real: `localhost` may resolve to IPv6/other mappings on some systems; explicit `127.0.0.1` is more predictable for local-only.

### Gap F — Hybrid mode limitations are backend-dependent, but backend is unspecified

The best-practices doc describes hybrid mode in terms of changing provider/base URL/model (and claims agentmux currently hard-codes provider).

In this repo, there is no backend runner implementation to validate or modify.

Impact:
- Hybrid recommendations are incomplete: we can describe the conceptual setup, but can’t give repo-grounded steps.

---

## 3) Recommendations (concrete, repo-aligned)

### R1 — Fix/retitle backend sections to match what exists in this repo

Pick one:
- **Option 1 (recommended):** Rename backend references to “external launcher (not in this repo)” and remove file-path citations to `agentmux/...`.
- **Option 2:** Vendor or submodule the backend launcher into this repo and make the citations real.

Minimum change: replace the “repo-grounded” claim in the title with wording like “pi-ghosty client + example sidecar settings”.

### R2 — Add a “Config surface” section and point to the real knobs

Update `hindsight_best_practices_pg0.md` to explicitly document:

- pi-ghosty env vars:
  - `HINDSIGHT_BASE_URL`, `HINDSIGHT_BANK_ID`, `PROJECT_TAG`, `GHOSTY_DISABLE_MEMORY` (`src/env.ts`; behavior in `src/extensions/memoryExtension.ts`).
- pi-ghosty config file knobs:
  - `defaults.memory.recall.*`
  - `defaults.memory.retain.*`
  - `defaults.runtime.*` (when using canonical config)

Point to canonical location:
- `pi-agent-canonical.json` is the authoritative “new-style” example.
- Mention that `pi-agent-local.json` is legacy-style but normalized (`src/config/loadConfig.ts`).

### R3 — Provide explicit recommended values for the new knobs (by scenario)

Because these are now supported, the doc should recommend them:

**Local-only (embedded pg0 + CPU constraints):**
- `defaults.memory.recall.queryMaxChars`: set a cap (e.g., 2k–8k chars) to prevent giant prompt queries (code now supports this). (`src/extensions/memoryExtension.ts`)
- Keep `tagsMatch: "all"` as default isolation.
- Consider lowering `maxFacts` below 30 if system prompt bloat is an issue.

**Hybrid:**
- Same as local-only, plus:
  - consider `budget: "low"` if latency is dominated by remote embedding/rerank steps (depends on Hindsight API).
  - keep `queryMaxChars` capped.

**Frontier:**
- Keep strict isolation (`tagsMatch: "all"`) unless you intentionally want project-wide recall.
- If you do want project-wide recall, recommend **separate banks per project/user** over weakening tag match.

(Important: these recommendations should be added to the doc; they are already partially described in `hindsight_recommendation_report.md`, but without mapping to the new config keys.)

### R4 — Clarify what “frontier config” means in this repo

Document that `pi-agent-frontier.json` does not set `defaults.runtime` (only memory + routing + agents), so frontier endpoints are expected to come from:
- env vars, or
- the canonical config file if present.

This is determined by `loadConfig()` search order (`src/config/loadConfig.ts`).

### R5 — Make localhost binding guidance consistent

If the best-practices doc recommends `127.0.0.1`, update the examples in the doc (and optionally `.env.example`) to use:
- `HINDSIGHT_BASE_URL=http://127.0.0.1:8888`

This avoids resolution surprises and aligns with “local-only means local”.

### R6 — Add a short “known limitations” block that matches current code

These should be explicitly stated as **current implementation constraints**:
- Reflect is not wired in pi-ghosty (`src/extensions/memoryExtension.ts`).
- `async` is best-effort and typed as `any` (retain uses `retainCfg.async`, recall still uses literal `async: true`).
- Recall types are configurable via `defaults.memory.recall.types`, but defaults are `observation/world/experience`.

---

## 4) Small correctness nits in the best-practices doc (actionable edits)

1) If you keep the “repo-grounded” wording, remove citations to missing `agentmux/...` files or bring them into the repo.
2) The doc should cite the new configuration keys from `src/config/schema.ts` and show an example snippet from `pi-agent-canonical.json`.
3) If you intend “frontier/hybrid/local-only” to be selected by config file, document the file precedence (`src/config/loadConfig.ts`).

---

## 5) Suggested checklist for Coordinator

- [ ] Decide whether backend launcher belongs in this repo; if not, scrub `agentmux/...` citations.
- [ ] Update `hindsight_best_practices_pg0.md` to include the `defaults.memory` knobs and recommended values.
- [ ] Add a short example showing how to set `defaults.memory.recall.queryMaxChars` and `tagsMatch` in `pi-agent-canonical.json`.
- [ ] Align examples to `127.0.0.1` for local-only.
- [ ] Ensure hybrid/frontier sections clearly distinguish pi-ghosty client settings vs Hindsight API server settings.
