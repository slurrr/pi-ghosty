# Current Goal
- Stabilize the interactive tmux War Room for `delegate` after the CLI-worker migration.
- Verify a fresh coordinator session gets fresh worker sessions, automatic top-right worker windows, and a useful bottom-right status board.

# Current State
- `delegate` now launches external worker `pi` sessions via CLI/job scripts instead of in-process `session.prompt`.
- Automatic War Room works: coordinator stays left, top-right is a nested worker tmux session, bottom-right is `scripts/ghosty-delegation-board.mjs`.
- Worker cycling now works in the nested worker pane via tmux session-local prefix `Ctrl-a`; outer tmux stays on `Ctrl-b`.
- Status board is driven from `~/runs/pi-ghosty/data/delegation-jobs/*/job.json`, not WorkflowMonitor.
- Status board now filters by `coordinatorSessionId`, sorts oldest→newest, keeps one line per job, and only redraws when content changes.
- Current uncommitted files: `.pi/extensions/ghosty/index.ts`, `lib/delegation/tmuxOrchestrator.ts`, `scripts/ghosty-delegation-board.mjs`.

# Decisions
- Keep the current status-line shape (`win:...`, headless PID note inline) because it is compact and useful for debugging.
- Scope the status board to the current coordinator session only; do not collapse jobs.
- Keep the worker viewport as a nested tmux session with per-worker windows rather than additional panes.
- Remove WorkflowMonitor from War Room status; delegation job files are the source of truth for this UI.

# Open Problems
- Need live validation in a **fresh coordinator session** to confirm the status board is actually filtered correctly and no old jobs bleed through.
- Need to confirm the board scroll behavior is acceptable now that rows are oldest→newest and redraws only happen on change.
- Possible future cleanup: optional `/ghosty war-room` reset/focus command if tmux state drifts.

# Resume Instructions
1. Commit the current War Room/status-board changes.
2. Start a **new coordinator session** and test delegating to multiple peers.
3. Verify three things: (a) fresh worker sessions per new coordinator session, (b) top-right worker window cycling with `Ctrl-a n/p`, (c) bottom-right board only shows jobs from the new coordinator session.
4. If filtering or scroll behavior is still off, inspect `scripts/ghosty-delegation-board.mjs` and the current session's `data/delegation-jobs/*/job.json` files first.
