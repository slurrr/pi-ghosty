# Functional & Historical Report: pi-ghosty

This document provides a comprehensive functional analysis of the `pi-ghosty` repository. Its purpose is to serve as a guide for a new team to understand the system's capabilities, separating currently active implementations from historical or legacy features.

---

## 1. Core Operating Model: Multi-Agent Delegation

The fundamental purpose of `pi-ghosty` is to transform the `pi` agent into a multi-agent system.

### 1.1. Current Implementation

-   **Corroborator & Peers**: A central `corroborator` agent serves as the user's interface and project manager. It delegates tasks to a team of specialized peers: `coder`, `researcher`, `reviewer`, and `memory`.
-   **Asynchronous Workflow**: Delegation is non-blocking. The `corroborator` assigns a task and can immediately proceed with other work.
-   **Structured Communication**: Peers receive a detailed "delegation envelope" with a clear objective, constraints, and context. They report back using a single, structured `peer_report` call upon completion. The report is injected back into the corroborator's session as a new event for it to process in a subsequent turn.
-   **Role-Based Personas & Tools**: Each agent role has a distinct persona, defined by a unique set of prompt files (`peers/<agent>/*.md`). The system dynamically modifies the agent's base system prompt based on its role. Each role is also configured with a specific set of active tools (e.g., `coder` has `edit`, `write`, `bash`; `researcher` has `read`, `grep`, etc.).

---

## 2. Session Management & Routing

This is the mechanism that decides whether a delegated task should resume a peer's previous session or start a new one. The implementation has evolved, leaving behind a more complex system in favor of a simpler, more direct approach.

### 2.1. Current Implementation: Simplified, Affinity-Based Routing

The currently active routing logic prioritizes simplicity and predictability over complex semantic analysis.

-   **Lifecycle Tied to Corroborator's Work**: Peer sessions are effectively scoped to the work being done by the `corroborator`. A new line of inquiry or a new corroborator session will generally spawn new peer sessions.
-   **Default Model Affinity**: The primary routing rule is based on the peer's configured `defaultModel`.
    1.  When a task is delegated to a peer (e.g., `coder`), the router checks if that peer has a default model specified in the configuration.
    2.  If it does, it looks for an existing, non-busy session for that peer that is already using that specific model. If one is found, it is reused.
    3.  If no such session exists, a **new session is created** and configured with that default model.
-   **Fallback to New**: If the peer has no `defaultModel` configured, the system defaults to creating a **new session** for the task.
-   **No Corroborator Session ID Link**: The link between corroborator and peer sessions is implicit. The logic doesn't directly check for the corroborator's session ID. Instead, because the delegation happens *within* the corroborator's context, the simple routing rules result in a fresh set of peer sessions for each distinct task or "main" session.

### 2.2. Historical Context: Deterministic + LLM Semantic Routing

The codebase and design documents contain a fully implemented, more sophisticated routing system that is currently bypassed by the simpler logic.

-   **Session Catalog**: A detailed `session-catalog.json` file tracks extensive metadata for every peer session, including usage statistics (message count, tool calls), health metrics, and a rich "semantic" block with a title, summary, and tags.
-   **Two-Stage Routing Pipeline**:
    1.  **Deterministic Prefilter**: This first stage would create a short list of candidate sessions by filtering out retired/busy sessions and preferring healthier, more recent ones based on the catalog's statistical metadata.
    2.  **LLM-Based Decision**: The candidate list and the new task description were then passed to a specialized, fast LLM call. This model's sole job was to read the semantic summaries of the candidate sessions and decide, based on the new task, whether it was more appropriate to `resume` one of them or start a `new` session.
-   **Semantic Enrichment**: The system was designed to automatically keep the catalog's semantic metadata fresh. It would trigger an LLM call to re-summarize a session if it had been a while or if significant new activity had occurred.
-   **Status**: This entire machinery for semantic routing and enrichment is still present in the code (`routePeerSession`, `maybeEnrichSemantic` in `index.ts`) but is effectively bypassed by the current `defaultModel`-based logic.

---

## 3. Worker Orchestration

Peer sessions are not just abstract contexts; they are independent processes running in the terminal.

### 3.1. Current Implementation

-   **Tmux Integration**: Peer workers are launched as new panes or windows within a `tmux` session, often referred to as the "War Room." This makes the peers' work visible and allows for manual inspection or intervention if needed. The `tmuxOrchestrator.ts` file manages the creation and layout of these windows.
-   **Durable Job Files**: Each delegation creates a set of job files on disk that track the task's state (launched, heartbeat, exited, report attached). The `peer_report` tool works by finding its job file (`GHOSTY_DELEGATION_JOB_PATH`) and attaching its report, which is how the result gets back to the main `corroborator` process.

---

## 4. Long-Term Memory (Hindsight Integration)

The system uses Hindsight to provide agents with long-term memory.

### 4.1. Current Implementation

-   **Role-Based Wiring**: The memory extension is wired up dynamically at the start of each session. It identifies the session's role (`corroborator`, `coder`, etc.) and configures the memory accordingly.
-   **Split Memory Banks**: The configuration supports split memory banks (e.g., `personal` and `procedural`). The `corroborator` is configured to recall from both, while the peers are configured to recall only from the `procedural` bank. This prevents personal preferences or conversational history from leaking into focused, technical peer sessions.
-   **Recall and Retain**: The system automatically injects recalled memories into the agent's context at the beginning of a turn and retains a transcript of the session at the end of a turn for future recall. Durable "receipts" of all memory transactions are saved to the run directory for auditability.

---

## 5. Agent Personas & Prompt Engineering

A core function of the repository is to define and manage the distinct personas of the `corroborator` and its peers. This is achieved through a systematic, multi-layered approach to modifying the `pi` agent's base system prompt.

### 5.1. General Prompt Sanitization

Before any role-specific modifications are made, the system performs two general cleanup steps on the base system prompt provided by `pi`:

1.  **Strip Project Context**: The system removes the entire "# Project Context" section that `pi` injects from local `AGENTS.md` files. This is a deliberate choice to ensure the agent's core identity is defined by this repository's configuration, not by ambient project files.
2.  **Clean Previous Injections**: It removes any leftover markers or content from previous `pi-ghosty` prompt modifications to ensure a clean slate for every turn.

### 5.2. Role-Specific Modifications

After sanitization, the system applies modifications based on the agent's role for the current session. This process has two parts: a first-paragraph replacement for non-coder peers, and the appendage of role-specific content.

#### 5.2.1. The `corroborator`

-   **First-Paragraph Replacement**: The initial paragraph of the system prompt is replaced with a directive focused on concise, direct interaction:
    > "answer only the smallest useful thing. when the useful answer is landed, stop immediately. do not add a victory lap, recap, or extra framing. leave room for the user to continue."
-   **Appended Content**: The contents of the markdown files in `peers/corroborator/` are concatenated and appended to the prompt. These files (`IDENTITY.md`, `SOUL.md`, `USER.md`, `CORROBORATOR.md`) define its core personality, its relationship with the user, and its operational mandate.

#### 5.2.2. The `researcher`

-   **First-Paragraph Replacement**: The first paragraph is replaced with a clear role definition:
    > "You are the researcher for an ai engineering team. Complete tasks as delegated. Focus on finding relevant information and insights from the web, documentation, and code, and report back concrete findings and summaries to the corroborator. Use the .pi/skills/peer-report/SKILL.md file for guidance."
-   **Appended Content**: The content from `peers/researcher/` (`00-role.md`, `01-peer-report.md`) is appended, reinforcing its role and reporting duties.

#### 5.2.3. The `reviewer`

-   **First-Paragraph Replacement**: The first paragraph is replaced with:
    > "You are the reviewer peer for an ai engineering team. Review proposed changes for correctness, safety, and scope drift, and report concrete issues and a short checklist back to the corroborator."
-   **Appended Content**: The content from `peers/reviewer/` (`00-role.md`, `01-peer-report.md`) is appended.

#### 5.2.4. The `memory` Peer

-   **First-Paragraph Replacement**: The first paragraph is replaced with:
    > "You are the memory peer for an ai engineering team. Focus on long-term memory behavior (recall/retain, tags, scopes, observations) and report recommendations back to the corroborator."
-   **Appended Content**: The content from `peers/memory/` (`00-role.md`, `01-peer-report.md`) is appended.

#### 5.2.5. The `coder`

-   **First-Paragraph Replacement**: The `coder` is the exception; its first paragraph is **not** replaced. It retains the original `pi` system prompt's opening, "You are an expert coding assistant...".
-   **Appended Content**: The content from `peers/coder/` (`00-role.md`, `01-peer-report.md`) is appended.

### 5.3. Shared System-Wide Content

Finally, after the role-specific modifications, the content of `.pi/APPEND_SYSTEM.md` is appended for **all** roles. This file contains shared directives and contracts that apply to every agent in the system, ensuring consistent behavior across the team.

## 6. Tooling & Automation

### 5.1. Current Implementation

-   **CLI Commands**: The extension registers several `/ghosty` slash-commands in `pi` for managing and observing the system:
    -   `/ghosty status`: Provides an overview of the system.
    -   `/ghosty smoke`: Runs a smoke test.
    -   `/ghosty workflow`: Displays the status of the workflow monitor.
    -   `/ghosty memory`: Shows the content that was most recently injected from Hindsight memory for the current session.
    -   `/ghosty models`: Shows the currently configured model scopes, presets, and defaults for each agent role.
-   **Workflow Monitor**: A background process (`WorkflowMonitor`) runs periodically (triggered by events like `turn_end`) to analyze the agent's activity based on signals from traces and artifacts. If it detects patterns of potential issues (e.g., loops, inefficiency), it can inject an "interrupt" message into the UI to alert the user.
-   **Scripts**: The `/scripts` directory contains various standalone scripts for maintenance, analysis, and debugging, such as printing memory receipts or performing meta-analysis on past workflows.
