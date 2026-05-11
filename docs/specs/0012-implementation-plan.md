# 0012 Implementation Plan: Agent OS Interactive CLI Delegation

## Problem
Implement `docs/specs/0012-agent-os-interactive-cli-delegation.md` by evolving Ghosty from in-process delegated peer prompting toward externally launched, interactive worker sessions managed through `pi` CLI + `tmux`.

The target shape is:
- coordinator stays active in the main session
- worker peers launch as real interactive `pi` sessions in tmux panes/windows
- worker sessions persist after completion
- completion handoff remains durable and filesystem-backed via `peer_report`
- session reuse stays simple and affinity-based

## Current Repo-Grounded State
Already present today:
- Main extension/orchestrator: `.pi/extensions/ghosty/index.ts`
- Async delegation return path with durable reports: `docs/specs/0007-async-delegation-return-path.md`
- Delegation report helpers: `lib/delegation/delegationReports.ts`
- Peer report tool/schema: `lib/delegation/peerReportTool.ts`, `lib/delegation/contracts.ts`
- Session reuse/catalog state: `lib/delegation/sessionCatalogStore.ts`
- Launch env propagation baseline: `scripts/dev-pi-extension.mjs`
- Existing tmux peer opening command path: `/ghosty peer open` logic in `.pi/extensions/ghosty/index.ts`

Important current behavior:
- delegation still runs in-process via `createAgentSessionFromServices(...)`
- delegated work is kicked off with `session.prompt(...)`
- tmux support exists for manually opening peer windows, but it is not yet the primary delegation path
- smoke coverage currently assumes the existing async delegation/report flow

## Scope
In scope:
- replace in-process worker execution with CLI-launched worker sessions
- define tmux orchestration behavior for launch/reuse/visibility
- preserve durable `peer_report` handoff via filesystem
- keep coordinator non-blocking
- preserve existing session-affinity catalog approach where practical
- update smoke/test coverage for the new execution mode

Out of scope:
- redesigning all prompt contracts
- replacing report-file persistence with a new IPC bus
- adding a separate daemon/watcher process unless clearly required
- large UI redesign beyond tmux orchestration and report injection behavior

## Design Constraints
- Prefer minimal diffs and extension-local changes first.
- Reuse existing delegation contracts and report file formats where possible.
- Preserve `runDir` layout under `~/runs/pi-ghosty` unless explicitly needed otherwise.
- Keep worker launch env consistent with `GHOSTY_PROJECT_DIR`, `GHOSTY_WORKDIR_MODE`, `GHOSTY_AGENT_CONFIG_PATH`, and `GHOSTY_PI_RUN_DIR`.
- Preserve current acceptance behavior from spec `0007` unless `0012` explicitly changes it.

## Architecture Delta
### Before
Coordinator delegation path:
1. build delegation envelope
2. route or create peer session
3. create peer session services in-process
4. call `session.prompt(...)`
5. capture `peer_report`
6. write durable report file
7. inject completion back into coordinator

### After
Coordinator delegation path:
1. build delegation envelope
2. route or create peer session identity
3. create a durable delegation launch record
4. spawn a `pi` CLI worker in tmux tied to that peer session
5. return immediately to coordinator
6. worker runs independently and calls `peer_report`
7. extension detects completion via durable report / lifecycle handoff
8. inject completion back into coordinator

## Proposed Modules / Change Surfaces
### Primary files
- `.pi/extensions/ghosty/index.ts`
  - replace in-process execution path
  - own launch metadata, pending jobs, handoff injection, and tmux orchestration calls
- `lib/delegation/contracts.ts`
  - extend launch/report metadata if needed for CLI/tmux execution
- `lib/delegation/delegationReports.ts`
  - preserve report naming and payload shape; add helpers if polling/lookup is needed
- `lib/delegation/sessionCatalogStore.ts`
  - continue to track affinity and session reuse, possibly with tmux/process metadata
- `scripts/dev-pi-extension.mjs`
  - ensure env propagation remains correct for spawned worker sessions
- `scripts/smoke-pi-extension.mjs`
  - adapt smoke flow to the new process model

### Likely new helper module(s)
Prefer one or two focused helpers rather than more logic in the extension file:
- `lib/delegation/tmuxOrchestrator.ts`
  - build tmux commands
  - open/reuse windows
  - name windows deterministically
  - optionally capture pane/window IDs
- `lib/delegation/workerLaunch.ts`
  - compose `pi` CLI command + env for a peer session
  - generate per-job launch script/command safely

If possible, keep these helpers dumb and string/IO-focused.

## Phased Plan

### Phase 0 — Baseline mapping and guardrails
Goal: make the migration explicit before changing behavior.

Tasks:
1. Map the exact current delegation path in `.pi/extensions/ghosty/index.ts`:
   - `launchDelegation(...)`
   - `createAgentSessionFromServices(...)`
   - `session.prompt(...)`
   - `finalize(...)`
   - report injection path
2. Map current tmux peer-open behavior:
   - `/ghosty peer open`
   - existing `tmux split-window` / `new-window` calls
3. Confirm current report-file lifecycle and fields against spec `0007`.
4. Confirm whether current `peer_report` callback depends on in-process session ownership.

Deliverable:
- short code-grounded notes in the implementation PR description or a follow-up note under `docs/reference/`

Suggested commands:
```bash
rg -n "launchDelegation|session\.prompt|createAgentSessionFromServices|peer_report|tmux|split-window|new-window" .pi/extensions/ghosty/index.ts
rg -n "delegationReport|writeDelegationReport|reportPath" lib/delegation
```

Acceptance:
- we have a precise list of which in-process assumptions must be removed or adapted

---

### Phase 1 — Extract launch/orchestration boundaries
Goal: separate "build delegation job" from "run worker".

Tasks:
1. Refactor `.pi/extensions/ghosty/index.ts` so launch preparation is independent of execution mode:
   - parse request
   - route peer session
   - allocate `jobId`
   - build delegation prompt
   - create immediate `DelegationLaunch`
2. Move command-construction concerns into a helper (`tmuxOrchestrator` and/or `workerLaunch`).
3. Keep current report-writing and coordinator injection logic intact during this phase.

Deliverable:
- extension code where launch prep returns a serializable launch object usable by either in-process or CLI execution

Acceptance:
- no behavior change yet for users
- typecheck still passes
- helper boundaries are clear enough to swap execution mode cleanly

---

### Phase 2 — Add worker CLI launch path
Goal: replace `session.prompt(...)` with spawned `pi` worker sessions.

Tasks:
1. Define a worker launch command shape:
   - `pi -e <ghosty extension> --session-dir <peer-session-dir> [--model ...]`
   - ensure worker starts in the correct `cwd`
   - propagate:
     - `GHOSTY_EXTENSION_ACTIVE=1`
     - `GHOSTY_PROJECT_DIR`
     - `GHOSTY_WORKDIR_MODE`
     - `GHOSTY_AGENT_CONFIG_PATH`
     - `GHOSTY_PI_RUN_DIR`
2. Decide how the delegation prompt is injected into the worker session:
   - preferred: non-interactive prompt argument / stdin bootstrap if supported by `pi`
   - fallback: generated launch script that starts `pi` and seeds the prompt deterministically
3. Store enough launch metadata for later monitoring:
   - job id
   - peer session id
   - tmux window/pane id if available
   - launch timestamp
4. Remove in-process `createAgentSessionFromServices(...)` delegation for worker execution.

Open question to settle in this phase:
- What is the smallest reliable way to seed the worker with the delegation message while preserving a real interactive TUI afterward?

Deliverable:
- a functioning CLI launch path behind a feature flag or directly replacing current worker execution

Acceptance:
- coordinator gets immediate launch result
- worker opens as a real `pi` session
- worker sees the full delegation envelope

---

### Phase 3 — Make tmux orchestration the primary worker UX
Goal: formalize war-room behavior.

Tasks:
1. Normalize tmux layout behavior:
   - coordinator remains in main pane/window
   - workers open in a dedicated visual area
   - use deterministic `tmux` window names such as `<peerName>:<shortJobId>` or `<peerName>`
2. Decide reuse rules:
   - reuse same peer session identity when affinity says resume
   - either reopen/focus existing tmux window or create a new visible window attached to the same session identity
3. Preserve persistence after completion:
   - do not auto-close worker window on successful completion
4. Keep fallback behavior when split-pane commands fail:
   - fallback to `tmux new-window`
   - provide a clean error if not running in tmux

Suggested tmux responsibilities:
- helper returns `{ windowId?, paneId?, windowName, mode }`
- extension logs these IDs in trace events

Acceptance:
- launched workers are visible and inspectable
- successful workers remain open after reporting
- failures surface clearly without blocking the coordinator session

---

### Phase 4 — Rework completion detection around durable reports
Goal: make report retrieval independent of in-process worker ownership.

Tasks:
1. Preserve `peer_report` durable write contract under:
   - `runDir/data/delegation-reports/**`
2. Replace in-process finalize assumptions with a report pickup path keyed by `jobId`.
3. Decide completion detection mechanism:
   - preferred: extension-owned lightweight polling of pending `jobId`s in-process
   - alternative: process-exit + file lookup if worker lifecycle can be monitored reliably
4. On successful report pickup:
   - validate payload
   - mark job settled
   - inject a follow-up message into the coordinator session
5. On missing `peer_report`:
   - implement fallback policy consistent with `docs/decisions/0004-peer-report-retry.md`
   - likely via process-exit handling + minimal recovery prompt or failure report record

Important note:
- Spec `0012` explicitly calls for process monitoring and filesystem retrieval on clean exit. That should be the target, but polling pending jobs by `jobId` is an acceptable first implementation if it keeps the diff smaller and remains reliable.

Acceptance:
- worker completion no longer depends on in-process callback wiring
- completed reports still appear as distinct coordinator follow-ups
- durable report files remain the source of truth

---

### Phase 5 — Health, loop detection, and recovery
Goal: cover the operational gaps called out in spec `0012`.

Tasks:
1. Add per-job state tracking for:
   - launched
   - running
   - reported
   - exited-with-report
   - exited-without-report
   - timed-out/stale
2. Add heartbeats or lightweight liveness checks:
   - tmux pane/window exists
   - child process still alive if PID is tracked
   - report file appeared
3. Integrate with existing loop/guard behavior where useful:
   - `lib/extensions/loopBreakerExtension.ts`
4. Define stale-job behavior:
   - notify coordinator after threshold
   - recommend manual intervention / window inspection

Acceptance:
- coordinator can distinguish healthy background work from stuck work
- missing-report cases are visible and actionable

---

### Phase 6 — Testing, smoke coverage, and docs
Goal: make the new flow safe to iterate on.

Tasks:
1. Update `scripts/smoke-pi-extension.mjs` to validate the new flow.
2. Add focused checks for:
   - immediate launch return
   - report file creation by `jobId`
   - coordinator follow-up injection
   - tmux fallback behavior when no tmux session exists
3. Update docs:
   - `docs/specs/0012-agent-os-interactive-cli-delegation.md` if implementation details crystallize
   - add a grounded reference note if needed for tmux command conventions
4. Run minimum verification:
   ```bash
   npm run typecheck
   npm run smoke:pi-ext
   ```

Acceptance:
- smoke still proves delegation is alive under the new execution model
- docs reflect actual launch and completion behavior

## Recommended Implementation Order
1. Phase 0
2. Phase 1
3. Phase 2 with a temporary feature flag if needed
4. Phase 4 before broadening tmux UX details
5. Phase 3 once completion path is stable
6. Phase 5 and Phase 6

Rationale:
- first separate launch metadata from execution
- then make worker launch real
- then stabilize completion detection
- only then lock in richer tmux behavior and recovery polish

## Suggested First PR Cut
Keep the first implementation PR small enough to review:
1. extract launch prep + add helper module for worker command construction
2. add CLI launch path behind a temporary config/env flag
3. keep existing report file format unchanged
4. prove one worker role end-to-end in smoke

This de-risks the migration before fully deleting the old in-process path.

## Open Questions Resolved
1. **Prompt seeding:** The coordinator will generate a temporary, hidden delegation task file. The worker `pi` CLI will be invoked to read this file as its first action. This ensures the worker has the full context (vision, files, tasks) without user-facing "hello" fluff or massive CLI arguments.
2. **Session identity vs tmux window identity:** A peer session identity maps to a persistent tmux window. If a session is resumed, the coordinator focuses/reuses that window. If a new session is created, a new window is spawned.
3. **Completion trigger:** The coordinator will primarily monitor for the creation of the durable `peer_report` file via a filesystem-backed signal or process exit. This ensures the result is injected back into the coordinator session immediately upon completion.
4. **Missing `peer_report`:** Handled manually during the stabilization phase. Since Seth is watching the War Room, he can steer the agent to call the tool or manually intervene if a session ends without a report.
5. **Batch concurrency:** The existing semaphore (maxParallelDelegations) remains in place to prevent terminal/mental "visual noise" and manage system load.

## Concrete Next Commands
```bash
rg -n "launchDelegation|session\.prompt|createAgentSessionFromServices|peer_report|tmux" .pi/extensions/ghosty/index.ts
read .pi/extensions/ghosty/index.ts
read lib/delegation/contracts.ts
read lib/delegation/delegationReports.ts
read lib/delegation/peerReportTool.ts
read lib/delegation/sessionCatalogStore.ts
read scripts/dev-pi-extension.mjs
read scripts/smoke-pi-extension.mjs
npm run typecheck
```

## Acceptance Criteria
This implementation plan is complete when the repo can support all of the following:
- `delegate` launches a real worker `pi` session in tmux rather than prompting a hidden in-process peer
- coordinator remains responsive immediately after launch
- worker sessions remain visible after completion
- worker completion produces durable `peer_report` files keyed by `jobId`
- coordinator receives a follow-up injection based on the durable report
- session affinity remains simple and predictable
- typecheck and smoke validation pass under the updated model
