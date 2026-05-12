---
name: peer-report
description: How peers must report results back to the corroborator in pi-ghosty using the peer_report tool.
---

# peer_report (pi-ghosty)

Use this when you are delegated a task and you need to return results to the corroborator.

## Quick rule
Call `peer_report` **exactly once** when finished.

## Tool
- `peer_report`: send your result back to the corroborator runtime

## What to include
- `summary`: the result in 1–5 sentences (required)
- optional `findings`: key bullets
- optional `artifacts`: file paths you touched/created
- optional `next_actions`: concrete next steps for the corroborator

## If you’re blocked
Don’t retry a missing/blocked tool in a loop. Read error messages, try a different approach, but don't get stuck.
Instead, `peer_report` with:
- a clear blocker in `summary` (missing tool/permission/data)
- a safe alternative in `next_actions` (different approach, or ask the corroborator to delegate to a peer with the right tools)
