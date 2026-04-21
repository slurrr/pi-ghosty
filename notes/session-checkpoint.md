# Current Goal
- Implement a stable v1 extension router/catalog base **and** fix “fresh session” startup semantics so a new coordinator session doesn’t inherit surprise scope/model state.

# Current State
- Run root is canonical: `/home/poop/runs/pi-ghosty`.
- Draft v1 spec exists: `docs/specs/0006-extension-mode-routing-and-catalog-v1.md`.
- Extension router/catalog implementation work has landed locally (uncommitted):
  - removed `request.model` from delegation contract (`src/runtime/contracts.ts`)
  - added per-session mutex + busy-session avoidance + weather/drift enrichment + delta-based semantic refresh + stats enrichment (`.pi/extensions/ghosty/index.ts`)
  - added `semantic.weather` to catalog schema + merge semantics (`src/runtime/sessionCatalogStore.ts`)
  - `npm run typecheck` and `npm run smoke:pi-ext` pass
- Pain point discovered: **new coordinator sessions are not “fresh” by default**; prior preset/scope state can carry over, causing confusing `enabledModels` scope and model selection.

# Decisions
- Fresh coordinator session behavior should be deterministic and minimal:
  - On new session start, set active preset to **`hybrid-default`**
  - Then set coordinator model to the config default for coordinator
  - **Unless persistence is enabled in config**, in which case we skip and let Pi default behavior take over.
- Keep the override surface simple (no extra flags/commands for common usage).

# Open Problems
- Where to implement the “fresh startup semantics” cleanly (launcher script vs extension `before_agent_start`), and how to detect “new session” reliably.
- Define what “persistence enabled” means in config (single boolean) and how it gates preset/model initialization.

# Resume Instructions
1. Read this checkpoint first.
2. Confirm working tree status and what’s uncommitted (`git status`).
3. Implement the fresh startup semantics:
   - new session => apply `hybrid-default` preset + set coordinator model from config
   - if persistence enabled => do nothing special
4. Re-run `npm run typecheck` and `npm run smoke:pi-ext`.
