# Peer Evolution Roadmap: The Agent OS

## Vision
Transition `pi-ghosty` from an MVP agent harness into a specialized "Agent OS." The Corroborator acts as a master planner (Fast/Plan-heavy), while a fleet of specialized peers handle execution with strict role boundaries to manage cost, context, and drift.

## Cost Management Strategy
- **Primary Execution (Coder)**: Maximize OpenAI Plus subscription quota (GPT-5.3/Codex).
- **Coordination/Planning (Corroborator)**: Use Fast Gemini (2.0 Flash) for high-speed master planning and long-context window.
- **Utility/Background Tasks**: Offload to "Mini" models via OpenAI OAuth (GPT-5.4 Mini) to minimize pay-as-you-go AI Studio credit burn.
- **Maintenance/Summary**: Offload to local vLLM models where possible.

## Proposed Peer Fleet

### 1. Spec Writer (The "Architect")
- **Role**: Define the "shape" of a feature before a single line of code is written.
- **Context**: Focused on requirements, edge cases, and architectural alignment.
- **Model**: `gpt-5.3-codex` or `gemini-2.0-flash` (for deep planning).

### 2. BB-Browser Pilot (The "Grounder")
- **Role**: Dedicated interface for web acquisition.
- **Quirks**: Knows the CDP port (19825), handles selector failures, manages authenticated session state.
- **Model**: `gpt-5.4-mini` or `gemini-1.5-flash` (cheap/fast web reasoning).

### 3. CI-Ops (The "Builder")
- **Role**: Handle repetitive, boring terminal tasks (linting, testing, building).
- **Context**: Stays in the build-loop so the Coder doesn't get distracted by error noise.
- **Model**: `gpt-5.4-mini` or local vLLM.

### 4. Comm-Link (The "Assistant")
- **Role**: Gmail management and Morning Briefings.
- **Context**: Interfacing with external APIs (GMail, Calendar) and summarizing daily state.
- **Model**: `gpt-5.4-mini`.

### 5. GitHub-Link
- **Role**: PR management, issue tracking, and repo health.
- **Model**: `gpt-5.4-mini`.

## Future Expansion Ideas
- **Log-Auditor**: A peer that specifically tails and audits long-running logs to flag anomalies.
- **Documentation-Ghost**: A peer that only updates `.md` files based on the Coder's git commits.
- **Security-Sentry**: A reviewer peer with a strict "security-only" system prompt.

## Implementation Plan
1. **Stabilize Core**: Ensure current refactor and War Room visibility are solid.
2. **Audit Defaults**: Shift Researcher/Reviewer to OpenAI Mini models to preserve Gemini credits.
3. **Register New Peers**: Update `pi-agent.json` with specialized roles and tool surfaces.
4. **Tool Partitioning**: Ensure `bb-browser` tool is ONLY available to the Pilot peer to prevent context leakage.
