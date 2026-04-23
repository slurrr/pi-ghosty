# Current Goal
- Make pi-ghosty useful day to day by automatically monitoring workflow friction/wins and surfacing screened candidates/winners on a heartbeat.

# Current State
- The repo is now extension-only: `src/runtime/*`, `src/index.ts`, and `src/tui/` have been removed.
- Workflow monitor is implemented for the extension path and peer tools path using `src/workflow/workflowMonitor.ts`.
- The monitor scans `runDir/data/traces/**`, scores repeatable pain/win signals, and writes durable summaries under `runDir/data/workflow/`.
- The coordinator path hooks the monitor on `session_start` and heartbeat-style input events in `.pi/extensions/ghosty/index.ts`.
- `/ghosty workflow` is available in extension mode, and `/peer workflow` shows the latest summary.
- Shared delegation helpers now live under `src/delegation/*` instead of the deleted runtime directory.
- `npm run typecheck` passes.
- `npm run smoke:pi-ext` passes.
- Extension-only retirement docs now reflect the final state:
  - `docs/reference/runtime_retirement_gaps.md`
  - `docs/specs/0008-extension-only-retirement.md`
- Added a delegation postmortem at `docs/reference/delegation_postmortem.md` covering prompt visibility, coordinator injection timing, durable report gaps, and peer overruns.

# Decisions
- Use deterministic, rule-based screening first; no LLM analysis loop for the workflow monitor v1.
- Keep raw capture append-only and store review snapshots as JSON under `runDir/data/workflow/`.
- Surface only screened candidates/winners to the user; keep everything else parked in background artifacts.
- Keep the workflow monitor best-effort and non-blocking.
- The old runtime is retired; the live path is the Pi extension plus shared extension-owned helpers.

# Open Problems
- Decide whether to prune or rewrite historical docs that still mention the old runtime for context.
- Decide whether to keep the extension-only retirement docs as permanent record or collapse them into the main architecture docs.

# Resume Instructions
1. If continuing workflow work, inspect `src/workflow/workflowMonitor.ts`, `.pi/extensions/ghosty/index.ts`, and `src/extensions/peerToolsExtension.ts` first.
2. Re-run `npm run typecheck` and `npm run smoke:pi-ext` after any workflow-monitor edits.
3. If simplifying the repo, consolidate or remove the unused runtime workflow-monitor file next.
