# Current Architecture Direction

## Purpose

`pi-ghosty` is being migrated from a hacked standalone runtime into a Pi-native extension implementation.

The old runtime still exists only as a behavioral reference while extension capabilities are proven out. The intended end state is:

- ghosty works as a Pi extension/package
- the old runtime is retired
- this repo no longer needs to act as a separate runtime app

## Canonical Direction

The extension is the future canonical implementation.

The old runtime is temporary and should be treated as:

- a reference implementation
- a source of behavior to port
- a compatibility baseline while proving extension parity

Not as the long-term architecture.

## Orchestration Goal

Ghosty should behave as one orchestrated agent system, not as separate incompatible "local mode" and "frontier mode" products.

The system must support:

- fully local operation
- fully frontier operation
- hybrid operation
- switching between those without redesigning the architecture

## Corroborator and Peer Model Behavior

The corroborator model must be selectable independently of peer models.

That means ghosty should support all of the following patterns:

- local corroborator with local peers
- frontier corroborator with frontier peers
- frontier corroborator with local coder/reviewer peers
- local corroborator with frontier specialist peers
- mixed peer pools where different roles prefer different model classes

Corroborator model choice must not force all delegated peers onto that same provider class.

## Role Defaults and Routing

Each agent role should be able to define a preferred default model.

Examples:

- corroborator defaults to a frontier model
- coder defaults to a local model
- reviewer defaults to a local or frontier model
- researcher defaults to a frontier model

These defaults are preferences, not hard locks.

Routing must be able to override defaults when appropriate for a task.

Desired behavior:

- cheap/small tasks can go to a local model such as omnicoder
- high-value or ambiguous tasks can go to a frontier model
- a role may normally use one model, but routing can choose another when it is a better fit

## Config Requirements

The config system must support all of the following at once:

1. Preserve old local behavior
   - Anything previously carried in `pi-agent.json` for local runtime behavior must still be passable to local models in the extension world.
   - This includes local-only request shaping such as sampling and `extra_body` fields.

2. Add frontier capability
   - Frontier-capable model definitions/config must coexist with local-capable definitions.
   - Frontier models should get only the settings they actually need.
   - Local-only request knobs must not be forced onto frontier models.

3. Allow arbitrary default model selection
   - It should be easy to change the default corroborator model.
   - It should be easy to change per-role defaults.
   - The system should not require architectural rewrites whenever model preferences change.

4. Support hybrid routing
   - A frontier corroborator must still be able to delegate to local models.
   - A local corroborator must still be able to delegate to frontier models.
   - Role defaults and routing overrides must coexist cleanly.

## UX Goal

The user experience should feel like a single flexible ghosty system.

Ideal user-facing behavior:

- I choose whatever corroborator model I want.
- Ghosty knows which models are available to which roles.
- Each role has sane defaults.
- Delegation can cross local/frontier boundaries.
- Routing can override defaults when helpful.
- Local models automatically get the request shaping they need.
- Frontier models remain clean and compatible.
- I can conserve frontier usage without breaking the whole system.
- I do not have to think in terms of separate incompatible config modes.

## Architectural Implication

The primary abstraction should not be "config file equals provider class."

The more correct abstraction is:

- one coherent config universe
- multiple model definitions or capabilities inside it
- per-role defaults
- per-task or routing overrides
- provider/model-specific request shaping applied only when that model is actually used

The important question is not:

- am I in local config or frontier config?

The important question is:

- which model is this session/role/task using right now, and what provider-specific behavior applies to that model?

## Current Working Principle

Ghosty extension should become a Pi-native multi-model orchestrator where:

- the corroborator can be local or frontier
- peers can be local or frontier independently
- each role has configurable default models
- routing can override role defaults
- local-only request knobs apply only when a local model is actually used
- frontier models remain compatible and uncluttered
- the whole system is driven from one coherent config model
- old runtime behavior is preserved only until extension parity is achieved

## Practical Summary

The intended experience is:

> Ghosty is one agent system. I can choose my corroborator model, set role defaults, and let delegation/routing mix local and frontier models intelligently, while each model automatically gets the right provider-specific behavior.
