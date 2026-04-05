# 0003: Explicit Peer Addressing via IO Prefix

## Status
Approved

## Context
We want deterministic delegation when the user explicitly requests a specific peer, without adding a host-side router or
heuristics.

The system has multiple IO fronts (Telegram now, pi-tui later). We want the behavior to be consistent across interfaces.

## Decision
Support explicit peer addressing via a prefix in user input:

- `@coder ...`
- `@researcher ...`
- `@reviewer ...`
- `@memory ...`

When the prefix is present, the IO layer (or a shared input-transform extension) rewrites the message into a coordinator
instruction that triggers delegation to the specified peer.

## Consequences
- Deterministic: if the user specifies a peer, it is used.
- Lightweight: no routing heuristics are introduced in v1.
- Extensible: the same mechanism can be implemented once and shared across Telegram and pi-tui.
