# Agent OS: Peer Directory & Scratchpad

This is the living directory for specialized peers in the `pi-ghosty` Agent OS. It defines active roles, proposed peers, and the strategic allocation of models to balance cost (OpenAI Quota vs. Gemini Credits) and performance.

## Current Peer Fleet (MVP)

| Peer Name | Primary Model | Thinking | Tools | Responsibility |
| :--- | :--- | :--- | :--- | :--- |
| **Corroborator** | `gemini-3-flash-preview` | Medium | `delegate`, `bash`, `read` | Master planning, problem definition, traffic control. Uses AI Studio API to bypass 1 RPM throttle. |
| **Coder** | `gpt-5.3-codex` | High | `edit`, `write`, `bash` | High-precision implementation. Uses OpenAI Plus Quota. |
| **Researcher** | `gpt-5.4-mini` | Medium | `web_search`, `read` | Info gathering. Uses OpenAI Plus Quota to save Gemini credits. |
| **Reviewer** | `gpt-5.4-mini` | Medium | `read`, `grep` | PR review and checklist. Uses OpenAI Plus Quota. |
| **Memory** | `vllm/omnicoder-9b` | Medium | `read`, `ls` | Hindsight maintenance. Local (zero cost). |

---

## Evolving the Fleet: Proposed Specialized Peers

### Phase 1: Context & Grounding Stabilization
- **`spec-writer`**:
  - **Goal**: Hardening the "shape" of a task before execution.
  - **Model**: `gpt-5.3-codex` (Precision) or `gemini-2.0-flash` (Breadth).
  - **Input**: User request + Repo state.
  - **Output**: A concrete spec/checklist for the Coder.
- **`bb-browser-pilot`**:
  - **Goal**: Reliable web acquisition without search API costs.
  - **Model**: `gpt-5.4-mini` (OAuth).
  - **Tools**: `bb-browser` (exclusive access).
  - **Context**: Maintains knowledge of authenticated session state and site-specific selector quirks.

### Phase 2: Operations & Maintenance
- **`ci-ops`**:
  - **Goal**: Managing the terminal build-test-lint loop.
  - **Model**: Local vLLM or `gpt-5.4-mini`.
  - **Task**: Running tests, fixing lint errors, reporting build breakages.
- **`github-linker`**:
  - **Goal**: PR and Issue management.
  - **Model**: `gpt-5.4-mini`.
  - **Tools**: `gh` CLI.

### Phase 3: Personal Utility (The "Daily Driver")
- **`briefing-peer`**:
  - **Goal**: Morning briefing on repo health, scheduled tasks, and world news.
  - **Trigger**: Cron or startup hook.
  - **Model**: `gemini-1.5-flash` (Cheapest).
- **`inbox-peer`**:
  - **Goal**: Triage and summarizing compromised/high-noise Gmail inboxes.
  - **Model**: `gpt-5.4-mini`.
  - **Tools**: `gmcli` (Gmail CLI).

---

## Future Peer Ideas (The "Ghost" Fleet)
- **`log-auditor`**: Continuously tails long-running logs (e.g., `GHOSTY_SAMPLING_TRACE`) to flag anomalies.
- **`doc-ghost`**: Automatically updates `.md` documentation based on git diffs from the Coder.
- **`security-sentry`**: A specialized reviewer with a strict security-first system prompt.
- **`wallet-watchdog`**: Monitors API credit burn and usage stats across providers, suggesting model swaps in real-time.

---

## Discussion Notes: Model Default Optimization
- **Goal**: Fully utilize OpenAI Plus (OAuth) before hitting paid Gemini credits.
- **Corroborator**: Needs speed + planning capability. Gemini Flash is likely the sweet spot.
- **High-Turn Peers**: Shift Researcher/Reviewer to OpenAI "Mini" models to minimize credit burn.
- **Low-Utility Peers**: Offload to local vLLM (Gemma/Omnicoder) for maintenance and summarization.
