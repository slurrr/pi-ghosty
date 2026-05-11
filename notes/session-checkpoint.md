# Current Goal
- Refactor `delegate` to spawn actual independent Pi sessions via CLI instead of in-process sub-agents.
- Enable true interactive background peers that show up in the tmux War Room.
- Finalize `pi-ghosty` as a daily-driver agent harness for shipping income-generating products (e.g., crypto trade calculator).

# Current State
- **Architecture**: Extension-based, but currently uses in-process sub-agents via `session.prompt`.
- **Visibility**: "War Room" layout exists but displays a "snapshot" of worker sessions rather than a live, interactive TUI.
- **Routing**: Session-affinity logic discussed; goal is "One Coordinator = One Team" to prevent context drift.
- **Grounding**: `bb-browser` stable on port 19825.

# Decisions
- **The "Ho Move"**: Pivot from in-process delegation to CLI-based delegation. Coordinator will `spawn` a `pi` CLI process.
- **Tmux Integration**: Use `tmux split-window` within the delegation tool to launch the worker's TUI. This ensures workers are "actual sessions" and provides real-time visibility.
- **Reliably Dumb Routing**: First-pass filter for session reuse will be the Coordinator's `sessionId` (affinity).
- **Project Context**: Avoiding "Project-based" affinity for now to keep implementation "dead simple" and avoid over-engineering.

# Open Problems
- **Interactivity**: Ensuring the spawned CLI TUI handles input/output correctly when launched via the coordinator's tool.
- **Pane Management**: Determining how to handle/close tmux panes once a peer completes its `peer_report`.
- **Workflow Monitor**: Needs hardening to ensure proactive "interrupt" power for long-running sessions.

# Resume Instructions
1. Open `.pi/extensions/ghosty/index.ts` and locate the `delegate` tool execution logic.
2. Refactor the `execute` call to use `spawn` to trigger the `pi` CLI with the `--session` flag instead of `session.prompt`.
3. Test triggering a delegation and seeing if a live tmux pane pops up with the active worker TUI.
