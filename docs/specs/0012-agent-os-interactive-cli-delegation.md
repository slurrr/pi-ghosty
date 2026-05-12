# 0012: Agent OS - Interactive CLI Delegation & Tmux Orchestration

**Status:** Proposed / Draft
**Role:** Definition Spec
**Author:** Sol & Seth

## The Vision
Shift `pi-ghosty` from a "sub-agent" extension to a true "Agent OS" where the Corroborator acts as a Command Center. This shift moves the system away from nested in-process execution and toward independent, interactive worker sessions. This architecture is designed to support a "CI for Ideas" workflow where the human (Seth) defines vision and approves deliverables while distancing themselves from the manual implementation details.

## Core Requirements

### 1. War Room Layout Evolution
The existing War Room layout is evolved to handle live, concurrent workers:
- **Command Center (Main Pane):** The Corroborator session for riffing and high-level project definition.
- **Worker Environment (Split Pane):** A dedicated area for active workers. This space uses **tmux windows or tabs** to allow multiple concurrent agents (e.g., Spec Writer, Coder, Reviewer) to run in the same visual area.
- **Status Visibility:** Elimination of static logs in favor of the live worker sessions. Seth can cycle through active worker windows to "inspect the work" in real-time.

### 2. CLI-Based Delegation Strategy
The `delegate` tool becomes a process orchestrator rather than a message passer:
- **Spawn vs. Prompt:** Instead of calling `session.prompt` in-process, the corroborator uses `spawn` to trigger a `pi` CLI session.
- **Interactive Lifecycle:** Workers launch in their own tmux windows/panes with the full TUI. This ensures workers are "actual sessions" that can be manually intervened in if necessary.
- **Persistence:** Worker windows remain open after task completion. This allows Seth to review the final TUI state and the generated report before closing the window manually.

### 3. Async Execution & Result Retrieval
- **Non-Blocking Orchestration:** The Corroborator remains active and responsive while workers are backgrounded.
- **Process Monitoring:** The Corroborator monitors the worker's process lifecycle. Upon a clean exit, it retrieves the generated `peer_report` from the filesystem and injects it back into the primary conversation.
- **Reliably Dumb Routing:** Sessions are reused based on Corroborator Session Affinity ("One Corroborator Session = One Worker Team") to ensure context consistency without over-engineering the routing logic.

### 4. Workflow Integration (CI for Ideas)
This infrastructure enables a multi-stage pipeline:
1. **Definition:** Seth and Corroborator riff to lock down a feature vision.
2. **Spec Writing:** A task is delegated to a `Spec Writer`. The worker window pops up; Seth monitors the blueprinting process.
3. **Implementation:** Upon spec approval, the task is handed to a `Coder`.
4. **Review/Redline:** A `Reviewer` peer inspects the work. Seth can observe any "arguments" or iterations between Coder and Reviewer by cycling windows.
5. **Final Handoff:** The Corroborator pings Seth for user testing once the pipeline clears.

## Next Steps for Implementation Spec
- Define the exact `tmux` commands for window/pane management during delegation.
- Establish the filesystem protocol for the asynchronous "hand-off" (where the report is saved and how it's picked up).
- Determine the mechanism for loop detection and health heartbeats.
