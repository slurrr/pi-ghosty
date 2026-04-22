# Current Goal
- Make pi-ghosty useful day to day by automatically monitoring workflow friction/wins and surfacing screened candidates/winners on a heartbeat.

# Current State
- Workflow monitor is implemented for the extension path and peer tools path using `src/workflow/workflowMonitor.ts`.
- The monitor scans `runDir/data/traces/**`, scores repeatable pain/win signals, and writes durable summaries under `runDir/data/workflow/`.
- The coordinator path now hooks the monitor on `session_start` and heartbeat-style input events in `.pi/extensions/ghosty/index.ts`.
- `/ghosty workflow` was added in the extension path, and `/peer workflow` shows the latest summary.
- Config/schema now includes workflow monitor defaults, and canonical/example configs were updated.
- `npm run typecheck` passes.
- `npm run smoke:pi-ext` passes.
- Added a delegation postmortem at `docs/reference/delegation_postmortem.md` covering prompt visibility, coordinator injection timing, durable report gaps, and peer overruns.

# Decisions
- Use deterministic, rule-based screening first; no LLM analysis loop for the workflow monitor v1.
- Keep raw capture append-only and store review snapshots as JSON under `runDir/data/workflow/`.
- Surface only screened candidates/winners to the user; keep everything else parked in background artifacts.
- Keep the workflow monitor best-effort and non-blocking.

# Open Problems
- Decide whether to delete or consolidate the now-unused `src/runtime/workflowMonitor.ts` path later.
- Decide whether to unify the runtime and extension workflow-monitor implementations/configs, or keep them separate.
- Decide whether to add a small README/doc note for the new workflow command.

# Resume Instructions
1. If continuing workflow work, inspect `src/workflow/workflowMonitor.ts`, `.pi/extensions/ghosty/index.ts`, and `src/extensions/peerToolsExtension.ts` first.
2. Re-run `npm run typecheck` and `npm run smoke:pi-ext` after any workflow-monitor edits.
3. If simplifying the repo, consolidate or remove the unused runtime workflow-monitor file next.
