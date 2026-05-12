# Architecture: pi-ghosty as a pure pi extension/package

Goal: reframe `pi-ghosty` from a standalone TypeScript host app into a **project-local pi extension (or pi package)** that runs inside upstream pi without forking pi-mono and without an app-specific harness.

This document is an implementation-oriented outline (not a full spec).

## Non-goals
- Do not fork `pi-mono` / `@mariozechner/pi-coding-agent`.
- Do not embed or reimplement InteractiveMode/TUI.
- Do not invent a parallel “agent runtime” abstraction when pi already provides session runtimes.

## Core idea
Instead of running `tsx src/index.ts`, we run upstream pi normally (TUI/RPC/etc.) and load a project-local extension:

- Extension location: `.pi/extensions/ghosty/index.ts`
- Optional packaging: publishable pi package (npm/git) that exposes that same extension entrypoint.

The extension:
- makes the current session the **Corroborator** session
- registers a `delegate` tool (and any other orchestration tools)
- creates/resumes peer sessions on demand using pi’s session/runtime APIs
- enforces a structured peer-report contract (via tool + schema)
- logs traces/artifacts under the configured runDir

## Filesystem layout (project)
Recommended layout for a “pure pi” ghosty project:

```
pi-ghosty/
  .pi/
    APPEND_SYSTEM.md
    settings.json           # optional pi project settings
    extensions/
      ghosty/
        index.ts            # main extension entrypoint
        package.json        # optional, if the extension needs deps
        src/
          config.ts
          paths.ts
          tools/
            delegate.ts
            peer_report.ts
          peers/
            sessions.ts
          trace/
            jsonl.ts
          prompts/
            peer_parts.ts
  peers/
    corroborator/*.md
    coder/*.md
    researcher/*.md
    reviewer/*.md
    memory/*.md
  pi-agent.json             # ghosty config (tool allowlists, model, memory, runDir)
  docs/
    reference/...
```

Key point: the extension code lives in `.pi/extensions/...` so `/reload` hot reloads it.

## Configuration
### Run directory
The extension should write runtime traces/artifacts to a machine-appropriate runDir, defaulting to:

- `~/runs/pi-ghosty`

Avoid writing runtime state into the repo.

Sources of configuration (recommended priority):
1) environment variables (for operator overrides)
2) `pi-agent.json` (project defaults)
3) hardcoded defaults

### Tool allowlists
pi already has the concept of *active tools*.
Ghosty’s allowlist can remain in `pi-agent.json` and be enforced by:
- setting the active tools on each peer session at creation time
- (optional) a tool_call policy extension for defense in depth

## Roles and prompts
### Corroborator
- The interactive pi session the user is in is the corroborator.
- Corroborator gets:
  - pi base system prompt
  - `.pi/APPEND_SYSTEM.md`
  - `peers/corroborator/*.md` appended

### Worker peers
Each peer session gets:
- pi base system prompt (but with a surgical first-sentence replacement so only `coder` keeps the “expert coding assistant” framing)
- `.pi/APPEND_SYSTEM.md`
- `peers/<peer>/*.md` appended

Implementation options:
- Use ResourceLoader hooks to inject per-session prompt overrides.
- Or use `before_agent_start` event to inject role headers.

## Orchestration flow
### Delegate tool
Register a corroborator-available tool:
- `delegate(peerName, task, context?, expectedOutput?)`

Execution:
1) Resolve/create the peer session (persistent)
2) Send a structured delegation prompt to the peer
3) Require peer to call `peer_report` tool exactly once
4) Parse/validate peer_report payload
5) Return a concise `toolResult.content` for the corroborator + include full structured result in `toolResult.details`

Important: keep the important results in `toolResult.content` so the corroborator model reliably “sees” it.

### Peer report tool
Register a tool that is only active inside peer sessions:
- `peer_report({ summary, findings?, artifacts?, nextActions?, ... })`

The tool:
- validates schema
- stores the payload in tool result `details` so the orchestrator can parse it

## Session management
In a pure pi extension, you should rely on pi’s own session runtime instead of rolling your own.

Approach:
- The extension should keep a map of peerName -> peer session file path (or discoverable session ids).
- Use pi’s session APIs to:
  - create a new peer session when missing
  - switch/load an existing peer session when needed

Note: pi’s public extension API is event-driven; session replacement APIs are exposed in command contexts (and via runtime classes in the SDK). A ghosty extension may need to model peers as separate SessionManager directories (one per peer) to avoid intermixing user session history with worker sessions.

## Tracing and observability
Use JSONL trace files under runDir:
- corroborator message entry
- delegation start/end
- peer session id/state
- peer_report received vs missing
- tool call/results summaries (when debug enabled)
- memory recall/retain timings (when enabled)

Key principle: tracing should be implemented as an extension (file-backed) so `/reload` updates it.

## Memory (Hindsight)
Treat memory as a service dependency.

v1:
- corroborator/peers call recall before turns and retain after turns
- keep recall bounded and inject into system prompt
- make memory optional (degrade gracefully when down)

Longer-term:
- allow per-peer banks or tags
- reduce prompt bloat (recall policy)

## Telegram
Telegram integration should remain upstream (`pi-telegram`).
Ghosty should only provide:
- corroborator behavior that knows how to respond to telegram messages
- optional helper tools (e.g. attach file) if needed

## Migration plan from current pi-ghosty
1) Move all inline extension factories into `.pi/extensions/ghosty/index.ts`
2) Remove custom TUI embedding (`InteractiveMode`) and run upstream `pi` in this repo
3) Keep only the minimal custom tools and orchestration logic as extension code
4) Verify:
   - `/reload` updates extension behavior
   - `/new` and `/resume` behave like upstream (no custom runtime host)
   - delegation works and peer_report is enforced

## Open questions / risks
- Best way to manage *multiple persistent peer sessions* from within one pi process without confusing the user’s session tree.
  - Likely: store peer sessions under a separate directory root (e.g. `~/runs/pi-ghosty/data/sessions/<peer>/...`) and open them explicitly.
- Whether to implement peer orchestration as:
  - a single `delegate` tool (simple)
  - plus additional commands (`/peers`, `/peer reset`, `/peer status`) for debugging.
