# Spec: Wire Hindsight memory into the pi extension path

## Problem
We aligned the memory implementation with Hindsight docs, but the current **pi extension path** does not actually wire the memory extension into the active session graph.

Result:
- memory hooks are present in `src/extensions/memoryExtension.ts`
- legacy runtime sessions wire them correctly
- the current `.pi/extensions/ghosty` path does **not** include them, so newer frontier-only sessions do not emit memory traces
- the newest session artifact (`7aea587b-20a8-4416-ab4b-b21cc5390ce5`) has transcript/session data, but no `data/traces` memory events

## Relevant findings
### Legacy/runtime path works
- `src/pi/createSession.ts:151` adds `memoryExtensionFactory(...)` unless `GHOSTY_DISABLE_MEMORY` is true.
- `src/extensions/memoryExtension.ts:142-377` already owns the trace emission for:
  - `memory_recall`
  - `memory_recall_error`
  - `memory_retain`
  - `memory_retain_error`
  - `memory_latency`
  - `memory_operation_status`
- `src/runtime/ghostyRuntime.ts:131-136` still writes runtime trace events like `session_catalog_loaded`.

### Current extension path is missing memory wiring
- `.pi/extensions/ghosty/index.ts:805-814` builds sessions with:
  - `noExtensions: true`
  - `extensionFactories: [samplingExtensionFactory(...), roleSystemPromptExtensionFactory(...)]`
- There is **no** `memoryExtensionFactory(...)` in that extension path.
- There is also no extension-side `JsonlTrace` usage outside the memory extension, so the absence of memory wiring means the absence of memory traces.

### `noExtensions: true` is intentional and should stay
This is not the bug.
- In `.pi/extensions/ghosty/index.ts`, `noExtensions: true` is used to prevent ambient cwd extension loading.
- That is correct for ghosty because we want an explicit, deterministic extension surface.
- **Do not flip it to false** just to “make memory work.”
- Instead, keep `noExtensions: true` and explicitly add the factories we want.

## Goals
1. Wire Hindsight memory into the active pi extension path.
2. Restore memory trace emission for extension-mode sessions.
3. Keep the extension surface explicit and deterministic.
4. Avoid reintroducing ambient or duplicate extensions.

## Non-goals
- Reworking Hindsight configuration defaults.
- Changing the memory schema unless needed for wiring.
- Switching ghosty to auto-load cwd extensions.
- Replacing the existing runtime/session machinery.

## Proposed implementation

### 1) Make memory wiring explicit in the extension path
Update `.pi/extensions/ghosty/index.ts` so the corroborator session and delegated peer sessions both include the memory extension.

Preferred shape:
- keep `noExtensions: true`
- add `memoryExtensionFactory(...)` to the extension factories used for:
  - the corroborator session
  - each delegated peer session

#### Corroborator session
The corroborator session in extension mode needs memory too.
Because the extension entrypoint only learns the session id at runtime, initialize memory wiring after `session_start` or via a small helper that can read the current session id from `ctx.sessionManager`.

#### Peer sessions
In `routePeerSession(...)` / delegation setup:
- peer session id is already known
- add `memoryExtensionFactory(env, config, parsed.peerName, peerSessionId, { runDir })`
- this gives peer sessions the same recall/retain behavior and trace output as legacy runtime sessions

### 2) Ensure traces come from the memory extension, not ad hoc logging
The memory extension already emits trace records through `JsonlTrace.forAgent(...)`.
So the wiring task is not to invent a second trace format; it is to make sure the extension is actually installed.

Trace expectations after wiring:
- `~/runs/pi-ghosty-pi/data/traces/corroborator/<sessionId>.jsonl`
- `~/runs/pi-ghosty-pi/data/traces/researcher/<sessionId>.jsonl`
- etc.

These files should contain the existing memory event types from `src/extensions/memoryExtension.ts`.

### 3) Prefer a shared extension-builder helper if duplication grows
To avoid drift between the legacy runtime path and the `.pi/extensions/ghosty` path, consider extracting shared session-extension assembly into a small helper.

Possible location:
- `src/pi/sessionExtensions.ts` or similar

The helper would return the curated extension list, including:
- sampling
- role/system prompt shaping
- memory
- any future debug tracing

This is optional, but it is the cleanest long-term fix if we want the runtime and extension paths to stay aligned.

### 4) Keep model-scope behavior separate from memory wiring
The failed delegate model selection issue is unrelated.
- The memory bug is about extension wiring and trace emission.
- Do not conflate it with `/scoped-models` or `enabledModels`.

## Implementation notes

### Memory extension ownership
`src/extensions/memoryExtension.ts` should stay the single owner of:
- Hindsight recall/retain logic
- token shaping
- trace emission for memory events

Do not duplicate its trace logic inside `.pi/extensions/ghosty/index.ts` unless there is a temporary bridge needed for session startup.

### Recommended minimal path
If we want the smallest safe change:
1. import and attach `memoryExtensionFactory(...)` in `.pi/extensions/ghosty/index.ts`
2. keep `noExtensions: true`
3. verify that the extension path now emits `data/traces/...` JSONL files again

## Acceptance criteria
- A fresh extension-mode session writes memory trace files under `~/runs/pi-ghosty-pi/data/traces/...`.
- Memory recall and retain events appear for the corroborator session.
- Delegated peer sessions also emit memory events if memory is enabled for peers.
- `noExtensions: true` remains in place.
- No ambient cwd extensions are loaded accidentally.
- The TUI can still run with the same explicit extension surface.

## Suggested verification
Run a fresh session and confirm:
- `~/runs/pi-ghosty-pi/data/traces/corroborator/<sessionId>.jsonl` exists
- it contains `memory_recall` and `memory_retain` events
- a delegated peer session trace exists and contains the same event types
- the trace files are written without enabling ambient `noExtensions: false`

## Open question
If we want corroborator memory to activate only after the first prompt instead of on session start, should the corroborator extension register the memory factory lazily after `session_start` or with a small helper that defers initialization until the session id is available?

Recommended answer: use the smallest lazy initialization that preserves one-time registration and keeps the extension explicit.
