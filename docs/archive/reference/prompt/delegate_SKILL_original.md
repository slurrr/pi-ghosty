---
name: delegate
description: Default/mandatory coordinator workflow. Use whenever the user says delegate/delegation/hand off/spawn a peer/ask the researcher/coder/reviewer/memory, or whenever a task requires repo investigation (search/grep/find/locate) or implementation work. If unclear, read this skill first. 
---

# Delegate (pi-ghosty)

Use this when you (the coordinator) should hand off a focused task to a worker peer.

## Quick rule
Before delegating, call `peer_tools` to see what each peer can do. Don’t guess.

## Tools
- `peer_tools`: shows peers + their available tools (source of truth = config)
- `delegate`: sends a task to a peer

## Choosing a peer
- If the task needs `bash`/`edit`/`write`, delegate to `@coder`.
- If it’s investigation within the workspace (read/grep/find/ls), delegate to `@researcher`.
- If it’s a review/checklist/safety pass, delegate to `@reviewer`.
- If it’s memory behavior/policy, delegate to `@memory`.

## Delegate inputs
Send:
- `peerName`
- `task` (one clear objective)
- optional `context`
- optional `expectedOutput`

## Output contract
Peers respond via `peer_report`.

If a peer can’t proceed (missing tools/permission/data), it must `peer_report` the limitation and a next step.
