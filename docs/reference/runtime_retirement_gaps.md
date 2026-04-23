# Runtime retirement gaps list

This document is now a retrospective cleanup record.
The runtime has been removed from the active path and the repo is extension-only.

## What was removed

- standalone entrypoint: `src/index.ts`
- TUI bootstrap: `src/tui/startTui.ts`
- orchestration runtime: `src/runtime/*`
- runtime copies of delegation/reporting/session/routing helpers

## What the extension path now owns

- coordinator startup and tool surface in `src/pi/createSession.ts`
- delegation and peer reports in `.pi/extensions/ghosty/index.ts`
- workflow monitoring in `src/workflow/workflowMonitor.ts`
- peer tool/status helpers in `src/extensions/peerToolsExtension.ts`
- shared delegation/session helpers in `src/delegation/*`

## Final state

There is no longer a second product path.
The repo now runs as a Pi extension with one source of truth for the live operator flow.
