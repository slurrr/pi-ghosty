# Current Goal
Add lightweight debug visibility that transcripts don’t capture (system prompt snapshots, tool gating blocks, tool surface, prompt-part provenance), all behind env flags with a single “enable all” flag.

# Current State
- Multi-peer runtime works (coordinator delegates to peers; peers report via `peer_report`).
- Run state lives under `~/runs/pi-ghosty` (sessions/traces/artifacts).
- Telegram bridge is connected via upstream `pi-telegram` extension (messages prefixed `[telegram]`).
- TUI supports `/system` and `/system guidelines` (live effective system prompt view).
- Repo has local changes in progress (debug flags + logging).

# Decisions
- Don’t persist system prompt by default; only capture it for debugging via explicit flags.
- Keep debug signals in JSONL traces under runDir (cheap to inspect; not in “session transcript”).

# Open Problems
- Confirm the new debug flags produce the expected files/events during real runs.
- Decide whether to keep `toolPolicyExtension`/`toolGatingExtension` as extensions long-term or shift responsibility elsewhere (don’t duplicate pi unless it’s buying us something).

# Resume Instructions
1. `npm run dev:debug` to run with all debug flags enabled.
2. In TUI, exercise a delegation turn and confirm:
   - system prompt trace appears under `~/runs/pi-ghosty/data/system-prompts/<agent>/<sessionId>.jsonl`
   - tool surface + prompt-part provenance events land in `~/runs/pi-ghosty/data/traces/<agent>/<sessionId>.jsonl`
   - tool gating blocks emit `tool_gating_block` events in the agent trace.
3. If noise is too high, switch to per-flag enabling (env vars in `src/env.ts`).
