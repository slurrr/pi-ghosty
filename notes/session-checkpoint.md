# Current Goal
- Finalize `pi-ghosty` as a daily-driver agent harness with reliable multi-peer routing and deep web grounding.
- Transition to a specialized "Agent OS" architecture using cost-aware model allocation.
- Harden the `WorkflowMonitor` logic and stabilize the multi-model hybrid engine.

# Current State
- **Cost-Aware Configuration**: **LOCKED IN** in `pi-agent.json`.
  - Coordinator: `gemini-3-flash-preview` (AI Studio - Plan-heavy).
  - Coder: `gpt-5.3-codex` (OpenAI Plus Quota).
  - Researcher/Reviewer: `gpt-5.4-mini` (OpenAI Plus Quota - Zero credit burn).
  - Memory: `vllm/omnicoder-9b` (Local - Zero cost).
- **Architecture Refactor**: **COMPLETED**. `src/` moved to `lib/`, legacy runtime removed.
- **Visibility**: **COMPLETED**. "War Room" layout (Coordinator + Peer + Live Log) is the default for `/ghosty peer open`.
- **Grounding**: `bb-browser` stable on port 19825.
- **Thinking Models**: Verified. Thinking support for Gemini is handled via `~/.pi/agent/models.json` overrides.
- **Workflow Monitor**: **HARDENED**. Stateful candidate tracking added; scores now accumulate correctly across turns.

# Decisions
- **Agent OS Strategy**: Use Fast Gemini for coordination, Codex for implementation, and OpenAI Mini/Local models for specialists to maximize subscription value and minimize credit burn.
- **Threshold Awareness**: Gemini 1.5 Flash is identified as the "Worker Bee" for cost-efficient document scanning ($0.075/1M tokens under 128k context).
- **Tracing**: `GHOSTY_SAMPLING_TRACE=1` is the toggle for real-time visibility into the "frozen" state of the LLM.
- **Monitor State**: Persist `activeCandidates` in `state.json` to allow long-term loop detection.

# Open Problems
- **Workflow Monitor**: Needs hardening to ensure proactive "interrupt" power for long-running sessions.
- **Peer Specialization**: Need to implement the tool-surface partitioning (e.g., ensuring `bb-browser` is exclusive to a Pilot peer) as outlined in the roadmap.

# Resume Instructions
1. Review `docs/architecture/agent-os-peer-directory.md` for proposed new peers (Spec Writer, BB-Browser Pilot).
2. Implement the `bb-browser-pilot` peer to centralize web acquisition quirks.
3. Monitor Gemini credit burn vs. OpenAI Plus usage under the new `mini` model assignments.
