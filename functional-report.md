# Functional Report: pi-ghosty Repository

This document provides a high-level functional overview of the `pi-ghosty` repository. It describes the capabilities and features the system provides, excluding details of its internal code and architecture.

## 1. Multi-Agent System

The core function of `pi-ghosty` is to extend the `pi` coding agent into a multi-agent system. Instead of a single agent handling all tasks, it establishes a team of specialized agents that work together.

## 2. Corroborator as the Primary Interface

The user's primary point of contact is an agent named the **`corroborator`**. This agent acts as a coordinator or project manager. It receives tasks from the user and is responsible for seeing them through to completion.

## 3. Task Delegation to Specialized Peers

The `corroborator` delegates specific types of work to a team of peer agents, each with a distinct role:

-   **`coder`**: Responsible for all programming tasks, including writing new code, editing existing files, and other development activities.
-   **`researcher`**: Gathers context and information. This could involve reading files, searching the web, or investigating a codebase.
-   **`reviewer`**: Acts as a quality assurance agent. It inspects work done by other agents, checks for errors, and ensures changes meet requirements.
-   **`memory`**: Manages the system's long-term memory, handling the storage and retrieval of information.

This delegation model allows for a separation of concerns, where each agent focuses on its area of expertise.

## 4. Persistent Memory (Hindsight Integration)

The system is equipped with a long-term memory capability through integration with a service called Hindsight. This allows the agents to learn and recall information across different sessions.

Key features of the memory system include:

-   **Memory Banks**: The memory is divided into different "banks" (e.g., `procedural`, `personal`) to organize different types of knowledge.
-   **Contextual Recall**: Agents can be configured to access specific memory banks relevant to their role. For example, the `corroborator` might access personal and procedural memory, while a `coder` peer might only access procedural memory.

## 5. Structured Workflows and Reporting

The interaction between agents is structured and auditable.

-   **Durable Records**: The system creates and stores detailed records of its operations, including session data, execution traces, reports from delegated tasks, and receipts for every memory transaction. This ensures that all activities are persistent and can be reviewed later.
-   **Formal Peer Reporting**: Peer agents must report the outcome of their delegated tasks back to the `corroborator` using a formal `peer_report` function.

## 6. Command-Line Management Tools

The extension provides several slash-commands within the `pi` environment for users to interact with and monitor the system. These include commands to check the system's status, inspect memory contents, and debug workflows.

## 7. Workflow Analysis and Automation

The repository contains scripts for meta-analysis of the system's performance. These tools can aggregate data from the durable records to provide insights into workflows, agent behavior, and memory usage over time (e.g., on a weekly basis).
