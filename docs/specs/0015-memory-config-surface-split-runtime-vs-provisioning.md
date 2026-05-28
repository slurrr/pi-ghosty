# Spec: Memory Config Surface Split (Runtime vs Provisioning)

## Problem
`pi-agent.json` currently mixes two different concerns:

1. **Runtime memory behavior** (used every agent run by the extension)
2. **Bank provisioning config** (used only when running `scripts/fix-memory.mjs`)

This makes the runtime config noisy, increases cognitive load, and causes uncertainty about what actually affects live behavior.

## Goal
Keep `pi-ghosty` extension runtime config lean, and move Hindsight bank provisioning knobs into a dedicated JSON config file consumed by `fix-memory.mjs`.

This preserves the current ownership model:
- Hindsight server: global/runtime infra
- Client (`pi-ghosty` + scripts): bank config ownership

## Scope
In scope:
- Define a new JSON file for bank provisioning config.
- Update `scripts/fix-memory.mjs` to read provisioning config from that file.
- Remove provisioning-only fields from `pi-agent.json`.
- Keep runtime memory behavior in `pi-agent.json`.

Out of scope:
- Re-architecting Hindsight server deployment.
- Repo split.
- Changes to memory retrieval logic in `memoryExtension.ts`.

## Design

### 1) Runtime config stays in `pi-agent.json`
Keep only runtime-relevant memory fields in `defaults.memory.*`, including:
- recall policy used at runtime (profiles, budgets, include chunks/source facts, maxFacts guard)
- retain runtime behavior
- bank identity/tags/scopes needed by extension

Do **not** keep bank provisioning-only Hindsight config under runtime memory config.

### 2) New provisioning config file
Create:
- `memory/banks.config.json`

This file becomes the source of truth for bank configuration updates applied via Hindsight config API.

Proposed shape:

```json
{
  "version": 1,
  "hindsightBaseUrl": "http://localhost:8888",
  "banks": {
    "procedural": {
      "bankId": "pi-ghosty-procedural",
      "updates": {
        "retain_extraction_mode": "concise",
        "retain_mission": "...",
        "observations_mission": "...",
        "consolidation_llm_batch_size": 8,
        "consolidation_max_memories_per_round": 100,
        "consolidation_source_facts_max_tokens": -1,
        "consolidation_source_facts_max_tokens_per_observation": 256,
        "max_observations_per_scope": -1,
        "reflect_mission": "...",
        "reflect_source_facts_max_tokens": -1,
        "recall_include_chunks": false,
        "recall_max_tokens": 2048,
        "recall_chunks_max_tokens": 1000,
        "disposition_skepticism": 3,
        "disposition_literalism": 3,
        "disposition_empathy": 3
      }
    },
    "personal": {
      "bankId": "pi-ghosty-personal",
      "updates": {
        "retain_extraction_mode": "concise"
      }
    }
  }
}
```

Notes:
- `updates` keys are already in the server-facing snake_case format used by PATCH `/banks/{bank_id}/config`.
- `hindsightBaseUrl` can be overridden by env var (`HINDSIGHT_BASE_URL`).

### 3) `fix-memory.mjs` behavior
Update `scripts/fix-memory.mjs` to:
- load `memory/banks.config.json` by default
- allow override via env var `GHOSTY_MEMORY_BANK_CONFIG_PATH`
- resolve base URL from:
  1) `HINDSIGHT_BASE_URL` env
  2) `banks.config.json.hindsightBaseUrl`
  3) `pi-agent.json.defaults.runtime.hindsightBaseUrl` (fallback for compatibility)
  4) default `http://localhost:8888`
- iterate `banks.*` and PATCH each `updates` object directly
- ignore `undefined` values as today

## Migration Plan

### Phase 1 (single PR)
1. Add `memory/banks.config.json` with current bank config values.
2. Update `scripts/fix-memory.mjs` to read from new file.
3. Remove provisioning-only `defaults.memory.banks.<role>.hindsight.*` fields from `pi-agent.json`.
4. Keep `defaults.memory.banks.<role>.bankId`, tags, scopes, and retain content in `pi-agent.json` (runtime concerns).

### Phase 2 (hardening)
- Add a small validation script or check to fail if provisioning-only keys are reintroduced into `pi-agent.json`.

## Acceptance Criteria
- Running `node scripts/fix-memory.mjs` applies bank config using `memory/banks.config.json`.
- `pi-agent.json` no longer contains provisioning-only bank config fields used only by `fix-memory.mjs`.
- Runtime memory behavior remains unchanged for extension execution.
- Operator can clearly answer:
  - "What affects runtime memory injection?" → `pi-agent.json`
  - "What config gets PATCHed to Hindsight bank config API?" → `memory/banks.config.json`

## Risks / Mitigations
- Risk: drift between runtime bank IDs and provisioning bank IDs.
  - Mitigation: keep bank IDs explicit in both files and document as shared invariant.
- Risk: confusion during transition.
  - Mitigation: update README/runbook with one short section and commands.

## Commands (operator)
- Apply bank config:
  - `node scripts/fix-memory.mjs`
- Apply with explicit file:
  - `GHOSTY_MEMORY_BANK_CONFIG_PATH=memory/banks.config.json node scripts/fix-memory.mjs`
- Apply with explicit Hindsight URL:
  - `HINDSIGHT_BASE_URL=http://localhost:8888 node scripts/fix-memory.mjs`
