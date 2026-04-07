# 0006: Disable automatic AGENTS.md context injection in pi-ghosty

## Status
Approved

## Context
pi (pi-mono) discovers and injects context files (e.g. `AGENTS.md`, `CLAUDE.md`) by walking up from the working directory.

On this machine, `~/AGENTS.md` is a large machine contract. Injecting it verbatim into every agent system prompt:
- bloats prompt size and input tokens
- dilutes role-specific instructions
- makes prompt behavior less predictable

For pi-ghosty specifically, our workflow prefers:
- small, explicit prompts from `.pi/APPEND_SYSTEM.md` + `peers/<agent>/*.md`
- explicit, intentional injection of additional context only when needed (via user message, artifacts, or dedicated tooling)

## Decision
In pi-ghosty, we disable automatic context-file injection (AGENTS/CLAUDE discovery) in the resource loader.

This is implemented by overriding resource-loader `agentsFilesOverride` to return an empty list.

## Consequences
Positive:
- smaller system prompts and more predictable behavior
- reduces accidental inclusion of machine-wide policies in every run

Tradeoffs:
- pi-ghosty no longer automatically benefits from repo/home-level AGENTS guidance
- if we want a particular guidance file included, we must inject it intentionally (prompt parts, explicit read, or a future “context injection” mechanism)

Reversal plan:
- remove the `agentsFilesOverride` override from `src/pi/createSession.ts`.
- optionally replace it with a filtered inclusion (e.g. include only repo-local `AGENTS.md`).
