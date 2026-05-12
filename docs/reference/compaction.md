Compacted from 117,522 tokens

Goal

- Stabilize and verify bb-browser grounding for web acquisition.
- Refactor project architecture to a clean extension-only model by removing legacy runtime "remnants."
- Transition pi-ghosty into a specialized "Agent OS" with cost-aware model routing and deep visibility.
- Harden the workflow monitor and stabilize the multi-model hybrid engine.

Constraints & Preferences

- Slow down and use "discussion mode" before executing destructive commands.
- Cost Management: Maximize OpenAI Plus subscription (OAuth) usage to save Gemini AI Studio credits; minimize pay-as-you-go costs.
- Visibility: Peer status must be observable in real-time to avoid "frozen snapshot" confusion.
- Ensure local models (vLLM) remain functional by migrating discovery logic before deleting source files.
- Maintain the authenticated browser profile link to bypass anti-bot detection.

Progress

### Done

- Verified bb-browser daemon lifecycle and grounding via Google Search.
- Architecture Refactor: Completed src/ -> lib/ rename and updated all imports.
- vLLM Migration: Moved discovery/registration logic to lib/config/vllmProvider.ts.
- Helper Extraction: Migrated standalone utilities to lib/utils/helpers.ts.
- Cleanup: Deleted legacy relics: lib/pi/, lib/env.ts, and lib/memory/hindsight.ts.
- War Room Layout: Updated /ghosty peer open to default to a 3-pane tmux layout (Corroborator left, Peer top-right, Logs bottom-right).
- Sampling Traces: Wired GHOSTY_SAMPLING_TRACE environment variable to stream raw tokens to logs.
- Agent OS Strategy: Created docs/architecture/peer-evolution-roadmap.md and docs/architecture/agent-os-peer-directory.md.
- Model Optimization: Updated pi-agent.json defaults to use gemini-3-flash-preview (Corroborator), gpt-5.4-mini (Researcher/Reviewer), and
vllm/omnicoder-9b (Memory).

### In Progress

- Hardening the WorkflowMonitor logic in lib/workflow/.
- Defining specific tool surfaces for new specialized peers (Spec Writer, BB-Browser Pilot).

### Blocked

- (None)

Key Decisions

- War Room Visibility: Defaulting to vertical/horizontal tmux splits to provide real-time JSONL trace visibility alongside interactive
peer sessions.
- Cost-Aware Routing: Corroborator stays on Gemini (speed/context), Coder on GPT-5.3 Codex (precision), while Researchers/Reviewers use
OpenAI "Mini" models to protect Gemini credits.
- Local Summarization: Offloading background maintenance (Memory/Summarization) to local vLLM models (Omnicoder-9b) to achieve zero-cost
overhead.
- Extension-Library Split: .pi/extensions/ghosty/index.ts is the entry point; lib/ is the modular supporting logic.

Next Steps

1. Verify local vLLM registration via the new vllmProvider.ts wiring in a live session.
2. Proceed to hardening WorkflowMonitor in lib/workflow/ (deterministic screening vs. proactive interrupts).
3. Implement the bb-browser-pilot peer to centralize web acquisition quirks.
4. Iterate on the "Spec Writer" peer to define task "shapes" before Coder execution.

Critical Context

- War Room Trigger: /ghosty peer open <name> (Fallbacks to new-window if split fails).
- Sampling Variable: GHOSTY_SAMPLING_TRACE=1 enables raw token streaming in the log pane.
- CDP Port: 19825 for bb-browser.
- Checkpoint Location: notes/session-checkpoint.md.
- Gemini 3 Flash: Currently preferred for Corroborator due to AI Studio 1 RPM throttle bypass.

────────────────────────────────────────────────────────────────────────────────

Turn Context (split turn):

Original Request

The user requested a comparison of Google Gemini models, specifically looking for cheaper Flash alternatives to Gemini 1.5 Pro. They also
inquired about the pricing of Gemini APIs and whether these models support "thinking levels" within the current TUI.

Early Progress

- The user established strict procedural boundaries: insisting on a slow, step-by-step approach rather than "one-shotting" tasks.
- Confirmed a preference for reserving Gemini 1.5 Pro for high-level "corroborator" tasks while seeking cost-effective alternatives for
secondary agents.
- Transitioned the interaction style back to a more deliberate, human-like conversational pace.

Context for Suffix

- Focus remains on analyzing Gemini API pricing and model capabilities (Flash vs. Pro).
- The "Thinking" feature status for Gemini models in the current interface is a pending question.
- The broader goal is architecting an "Agent OS" with optimized API spend.

<read-files>
/home/poop/.local/bin/bb-browser
/home/poop/.pi/agent/skills/local/checkpointing/SKILL.md
/home/poop/.pi/agent/skills/pi-skills/bb-browser/SKILL.md
/home/poop/code/dev/pi-ghosty/.pi/skills/delegate/SKILL.md
/home/poop/code/dev/pi-ghosty/.pi/skills/peer-report/SKILL.md
/home/poop/code/dev/pi-ghosty/notes/session-checkpoint.md
/home/poop/code/forks/bb-browser/dist/cli.js
/home/poop/runs/pi-ghosty/data/traces/researcher/59cdfe8e-bb68-4c21-a7f5-5298ba002b09.jsonl
bt
lib/config/vllmProvider.ts
lib/extensions/memoryExtension.ts
lib/extensions/samplingExtension.ts
lib/logging/jsonlTrace.ts
lib/utils/helpers.ts
package.json
scripts/dev-pi-extension.mjs
src/pi/createSession.ts
src/pi/vllmModelDiscovery.ts
</read-files>
<modified-files>
.pi/extensions/ghosty/index.ts
docs/architecture/agent-os-peer-directory.md
docs/architecture/peer-evolution-roadmap.md
notes/session-checkpoint.md
pi-agent.json
</modified-files>