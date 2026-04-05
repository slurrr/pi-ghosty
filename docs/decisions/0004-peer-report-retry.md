# 0004: Retry Once When `peer_report` Is Missing

## Status
Approved

## Context
Peer sessions are expected to end each delegated task by calling the `peer_report` tool so the host can return a compact,
structured result to the coordinator.

Small local models may occasionally omit the tool call, especially in fresh sessions or when a task ends with tool output.
We want a lightweight recovery behavior that avoids adding complex routing or parsing logic.

## Decision
If a delegated peer turn completes without a `peer_report` tool call:

1. Record the event in the runtime trace.
2. Retry once with a minimal follow-up prompt that instructs the peer to call `peer_report` immediately.
3. If the second attempt still does not produce a `peer_report`, fall back to using the peer’s last assistant text as
   `summary`.

## Consequences
- Keeps the preferred tool-first boundary without requiring strict output parsing.
- Adds one bounded retry in the failure case only.
- Preserves a graceful fallback path.
