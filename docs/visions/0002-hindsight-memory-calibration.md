# Vision Spec: Hindsight Memory Calibration (Role-Based)

## Context
Current memory injection in `pi-ghosty` uses a global `maxFacts` (default 30) hammer that ignores token density and role-specific needs. This results in the "robot brain" (too much noise for the corroborator) or "context starvation" (not enough technical detail for workers). 

Based on research into Hindsight's documented best practices (Peer Report: `2026-05-12T20-41-33.936Z-researcher-a1e9f3bb-cfa5-41b3-8ef5-51382cebd19a.json` and `2026-05-12T20-17-33.406Z-researcher-5fc9b805-0fc9-4e84-8360-de3d3eb83b5f.json`), we are moving to a role-based token budget system.

## The Strategy: "Vibe vs. Resolution"
We will bifurcate memory profiles based on the agent's intent. 

### 1. Corroborator (Narrative/Focused)
The goal is high-level continuity and "big picture" awareness without technical clutter.
- **Total Token Budget:** ~2048 - 3072 tokens (Hindsight "Focused" floor).
- **Split:** 
    - **Personal Bank:** 1024 tokens (Vibe and human context).
    - **Procedural Bank:** 1024 tokens (Global cross-project awareness).
- **Source Facts:** 256 tokens (Minimal provenance/auditing).
- **Chunks:** **DISABLED** (Zero raw code blocks during riffing).
- **Search Depth:** `mid` (Balanced breadth/speed).

### 2. Workers (Technical/Comprehensive)
The goal is high-resolution technical accuracy and deep repo awareness.
- **Total Token Budget:** ~8192 - 12288 tokens (Hindsight "Comprehensive" ceiling).
- **Split:** 
    - **Personal Bank:** **DISABLED** (Pure technical mercenaries).
    - **Procedural Bank:** 1024 tokens (Observations/patterns).
- **Source Facts:** 4096 tokens (Detailed instruction/history extraction).
- **Chunks:** 8192 tokens (Raw code snippets/context).
- **Search Depth:** `high` (Exhaustive retrieval).

---

## Implementation Requirements

### Schema Changes (`lib/config/schema.ts`)
- Introduce `memoryProfiles` block under `defaults`.
- Add `memoryProfile` key to agent definitions to allow role inheritance.
- Replace `maxFacts` logic with explicit token-cap fields: `maxTokens`, `sourceFactsMaxTokens`, `chunksMaxTokens`.

### Logic Changes (`lib/extensions/memoryExtension.ts`)
- Remove `facts.slice(0, recallCfg.maxFacts)` truncation.
- Resolve effective memory configuration hierarchically: `global default` -> `profile default` -> `agent override`.
- Pass per-bank `max_tokens` and sub-budgets for chunks/source facts into the Hindsight recall query.

---

## Retrospective Notes (Seth & Christopher)
- **The "Vibe" Experiment:** We initially wanted very lean 500/800 splits to kill the "robot voice." Research suggests this may be too aggressive a lobotomy. We are starting at 1024/1024 to see if the "Focused" Hindsight setting improves signal without the noise.
- **The Noise Floor:** If 2048 tokens still feels like a jira ticket, we will revisit the 500/800 "lean" split despite the Hindsight defaults.
- **Worker Lag:** High search depth + 8k chunks for workers will be slower. This is an acceptable trade-off for technical accuracy.
- **Global Procedural:** Confirmed that Procedural recall is global (not project-scoped), enabling cross-project pattern recognition.

## Next Steps
1. Patch `schema.ts` to support the new profile structure.
2. Update `memoryExtension.ts` to utilize Hindsight token budgets.
3. Apply the "Corroborator" and "Worker" profiles in `pi-agent.json`.
