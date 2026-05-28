# Functional Mechanics Report: pi-ghosty

This document explains the core operational mechanics of the `pi-ghosty` system. It describes *how* its key functions work without detailing the underlying code or architectural decisions.

## 1. The Delegation and Reporting Loop

The interaction between the main `corroborator` agent and its specialized peers follows a distinct, asynchronous process.

### How Delegation Works

1.  **Initiation**: The `corroborator` initiates a task by calling the `delegate` tool. It does not wait for the task to be completed.
2.  **Asynchronous Handoff**: The delegation is non-blocking. Once the task is handed off, the `corroborator` is free to continue with other work in the same turn.
3.  **The Delegation Envelope**: The `corroborator` packages the task in a structured format called an "envelope." This includes:
    *   **Peer Name**: The specific peer being assigned the task (`coder`, `researcher`, etc.).
    *   **Task**: A clear objective, a set of constraints, and concrete steps for the peer to follow.
    *   **Context**: Optional background information to help the peer understand the task.
    *   **Expected Output**: A template describing how the peer should structure its final report.

### How Peer Reporting Works

1.  **Signal of Completion**: A peer signals that its work is finished by calling the `peer_report` tool **exactly once**.
2.  **Structured Report**: The peer's output is not freeform text. It is a structured report containing:
    *   A required `summary` of the results.
    *   Optional `findings` (key discoveries, often as bullet points).
    *   Optional `artifacts` (a list of created or modified file paths).
    *   Optional `next_actions` (concrete steps recommended for the `corroborator`).
3.  **Asynchronous Return**: The peer's report does not arrive in the middle of the `corroborator`'s turn. Instead, it is injected into the system as a new event, which the `corroborator` picks up and processes on a subsequent turn.
4.  **Handling Blockers**: If a peer gets stuck (e.g., a tool fails), it does not get into a retry loop. Its process is to immediately use `peer_report` to inform the `corroborator` about the specific blocker and suggest an alternative course of action.

## 2. Session Routing: Deterministic Session Selection

When the `corroborator` delegates a task, the system must decide if the peer should resume a previous conversation ("session") or start a fresh one. This process is handled by a mechanism that functions as a "session router." Its goal is to make this choice deterministically and intelligently.

The routing process works in a two-stage pipeline:

### Stage 1: Deterministic Prefiltering

First, a set of hard-coded, deterministic rules are applied to find suitable existing sessions. This stage does not use an AI model.

1.  **Gather Candidates**: The router consults a persistent **Session Catalog**, a file that tracks all historical peer sessions and their metadata.
2.  **Apply Hard Filters**: It creates a candidate list by filtering the catalog based on "health" metrics. It will:
    *   Exclude sessions that are marked as retired or are currently busy with another task.
    *   Prefer sessions that are more recent, have used less of their context window, and have undergone fewer compactions (a process of summarizing a long session).
3.  **Limit Candidates**: The final list of candidates passed to the next stage is capped at a small number to ensure the process is efficient.

### Stage 2: LLM-Based Routing Decision

The filtered list of candidate sessions is then passed to a specialized, highly constrained AI model call.

1.  **Analyze Task**: This routing model examines the new task's objective and context.
2.  **Compare to Candidates**: It compares the task against the semantic metadata of the candidate sessions (their titles, summaries, and tags).
3.  **Make a Choice**: Based on this comparison, the model makes a final decision: `resume` an existing session or start a `new` one.
4.  **Structured Output**: Its decision is returned in a strict JSON format, which includes the action (`resume` or `new`), the `sessionId` if resuming, a `reason` for the choice, and a `confidence` score. If this step fails or produces an invalid output, the system deterministically defaults to creating a `new` session to ensure stability.

### Supporting Mechanics

-   **The Session Catalog**: This is the system's memory of past work, stored in `<runDir>/data/session-catalog.json`. Each entry contains not only the session ID but also usage statistics and an AI-generated semantic summary of the session's purpose and content.
-   **Semantic Enrichment**: The metadata in the catalog is kept up-to-date automatically. The system periodically uses an AI call to refresh a session's semantic summary when enough new activity (e.g., messages, tool calls) has occurred.
-   **Concurrency Safety**: The system uses a locking mechanism on each session ID. This prevents a situation where two separate tasks might be assigned to the same session simultaneously, which would corrupt the session's context.
