# Spec 0008: extension-only retirement complete

## Status

Approved

## Result

The old runtime has been removed.
pi-ghosty now runs as a Pi extension only.

## What remains

- `.pi/extensions/ghosty/index.ts`
- `src/pi/createSession.ts`
- `src/extensions/*`
- `src/delegation/*`
- `src/workflow/*`
- `src/config/*`
- `src/logging/*`
- `src/memory/*`
- `src/artifacts/*`
- `src/prompts/*`

## Removed

- `src/index.ts`
- `src/tui/startTui.ts`
- `src/runtime/*`

## Acceptance achieved

- extension path runs without the old runtime bootstrap
- delegation still works
- peer reports still arrive durably
- workflow monitoring is single-sourced
- typecheck passes
- smoke test passes

## Notes

The repo should treat the runtime as historical context only.
New work should target the extension path and shared extension-owned helpers.
