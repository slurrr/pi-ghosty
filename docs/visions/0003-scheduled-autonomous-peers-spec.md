# Vision Spec: Scheduled Autonomous Peers (MVP Blueprint)

**Goal:** To offload repetitive, context-heavy, or time-sensitive administrative tasks (e.g., email triage, calendar monitoring) from the primary user/Corroborator by implementing specialized, autonomous agent peers.

**Core Philosophy:** Decouple task execution from long-term state management. Tasks should be self-contained, running on a schedule rather than on-demand.

**Architecture Components:**

1.  **Specialized Peers:** Each peer is designed for a single, defined domain (e.g., Email Peer, Calendar Peer).
2.  **Execution Model:** Peers operate via scheduled, periodic calls (e.g., cron jobs) rather than active, persistent sessions.
3.  **Task Flow (Stateless Execution):**
    *   Scheduled call fires.
    *   LLM is invoked with the task prompt/skill.
    *   The LLM executes the task (e.g., triages inbox, summarizes).
    *   The LLM generates the required output (e.g., summary, flagged items).
    *   The LLM updates the relevant pattern/state in the designated Memory Bank.
    *   The process terminates.
4.  **State Management (Future/Target State):**
    *   **Pattern Storage:** State (e.g., spam patterns, contact history) is stored in dedicated Hindsight Memory Banks per peer/task, not in local files.
    *   **Corroborator Interaction:** The main Corroborator can selectively recall low-token-count, high-quality facts from these worker memory banks during its own turns, providing context without requiring the worker to be actively "in session."
5.  **Failure Handling (MVP):**
    *   Implement basic retry logic (1-2 attempts) for the LLM call.
    *   If all retries fail, the worker generates a final, structured "Error Report" detailing the failure reason, rather than failing silently.

**Next Steps:**
1.  Stabilize Hindsight Memory Bank functionality.
2.  Implement the first worker (e.g., Email Peer) using the defined workflow, targeting the pattern storage mechanism.