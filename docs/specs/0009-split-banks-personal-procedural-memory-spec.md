# Spec: Split personal vs procedural memory banks

## Problem

pi-ghosty currently treats memory as a **single bank**:

- `src/extensions/memoryExtension.ts` resolves one `bankId` from `HINDSIGHT_BANK_ID` / runtime config / fallback.
- Every agent session recalls from that same bank.
- Every agent session retains back into that same bank.
- The only separation available today is by tags and observation scopes.

That works for a simple setup, but it mixes two different kinds of long-term memory:

1. **Personal preferences / durable user context**
   - writing style
   - communication preferences
   - stable decisions
   - recurring constraints

2. **Procedural memory / work memory**
   - repo facts
   - task progress
   - troubleshooting context
   - implementation decisions
   - peer workflow history

The desired behavior is:

- keep those concerns in **separate banks**
- let the **corroborator** recall from both banks
- let **working peers** recall only the procedural bank
- keep working peer prompts cleaner and more task-focused
- allow distinct retain/observation missions per bank

## Scope

This spec covers the migration from the current single-bank setup to a split-bank memory architecture in the pi-ghosty extension path.

In scope:

- memory bank configuration shape
- bank selection rules for recall and retain
- prompt injection rules by role
- migration path from the current single-bank default
- observability and receipts for split-bank operation

Out of scope:

- redesigning the Hindsight server
- changing Hindsight’s core recall/retain APIs
- adding a UI for bank curation
- automatic semantic classification of memories beyond simple role/target routing

## Requirements

### 1) Two bank roles

The system must support two conceptual banks:

- **procedural bank**
  - default work memory
  - injected into corroborator and all working peers
  - stores task and repo context
  - should remain the primary source for day-to-day delegation and implementation work

- **personal bank**
  - durable user/preferences memory
  - injected into corroborator only
  - stores preferences, stable decisions, and long-lived user context
  - should stay out of working peer prompts

### 2) Corroborator sees both banks

The corroborator session must be able to recall from both banks.

Required order:

1. personal bank first
2. procedural bank second

Reasoning:

- workflow and preference shaping should come first, because bad workflow can make procedural facts less useful
- personal preferences should bias the corroborator before work-memory facts are considered
- procedural context still matters, but it should be interpreted through the corroborator’s preference/workflow frame

### 3) Working peers see procedural only

Working peers (`coder`, `researcher`, `reviewer`) must only receive procedural memory injection.

This is the key cleanliness guarantee:

- their prompts stay focused on current work
- personal preference noise does not leak into implementation sessions
- peer context size stays smaller and more predictable

### 4) Separate retain / observation missions

Each bank must be able to define its own memory mission and observation rules.

Recommended semantics:

- procedural bank mission: capture task, repo, implementation, troubleshooting, and workflow facts
- personal bank mission: capture user preferences, stable habits, and durable behavioral constraints

The architecture should allow different Hindsight server-side missions per bank.

### 5) No backward-compatibility layer

We do **not** need to preserve a runtime compatibility layer for single-bank and multi-bank modes at the same time.

This migration is intentionally a one-way simplification:

- move from one bank to two banks in the new design
- keep the code path focused on split-bank operation
- if you ever want to go back to single-bank behavior, roll back the configuration to a single bank setup

In other words, backward compatibility here is effectively a **configuration rollback**, not a code-path requirement.

## Constraints

- Keep the change small and explicit.
- Do not weaken bank isolation by widening tag matches.
- Do not merge personal and procedural memory into one shared tag pool.
- Do not make working peers recall the personal bank by default.
- Do not introduce a new runtime service just to manage bank routing.

## Proposed configuration shape

Add an explicit split-bank block under memory config.

Example shape:

```json
{
  "defaults": {
    "memory": {
      "banks": {
        "procedural": {
          "bankId": "pi-ghosty-procedural",
          "injectInto": ["corroborator", "coder", "researcher", "reviewer", "memory"],
          "retainFrom": ["corroborator", "coder", "researcher", "reviewer", "memory"],
          "retainMission": "Capture procedural knowledge, task progress, repo facts, implementation decisions, and troubleshooting context.",
          "observationScopes": {
            "includeProjectScope": true,
            "includeAgentScope": true,
            "includeSessionScope": false
          }
        },
        "personal": {
          "bankId": "pi-ghosty-personal",
          "injectInto": ["corroborator"],
          "retainFrom": ["corroborator", "memory"],
          "retainMission": "Capture user preferences, stable habits, recurring constraints, and durable decisions.",
          "observationScopes": {
            "includeProjectScope": false,
            "includeAgentScope": false,
            "includeSessionScope": false
          }
        }
      }
    }
  }
}
```

Notes:

- `procedural.bankId` can default to the current `HINDSIGHT_BANK_ID`.
- `personal.bankId` should be explicit, or derived from a stable default like `projectTag + "-personal"`.
- The `retainFrom` / `injectInto` lists are app-level policy, not Hindsight server policy.

## Proposed behavior

### Recall path

On `before_agent_start`:

- determine the active role
- resolve the configured banks for that role
- recall from each applicable bank
- merge results into the injected memory block(s)

Recommended merge order:

- procedural first
- personal second for corroborator

Recommended formatting:

- label each section with its bank purpose and bank id
- keep source separation visible in receipts and traces
- avoid flattening both banks into one undifferentiated blob

### Retain path

On `agent_end`:

- write to the procedural bank for all agents, so work memory stays current
- write to the personal bank only when the role/policy allows it
  - default recommendation: corroborator + memory peer only

This keeps personal memory from being polluted by every peer transcript while still allowing the corroborator to capture durable user context.

### Observation scopes

Observation scope defaults should remain bank-specific.

Recommended defaults:

- procedural bank:
  - project + agent scope on
  - session scope optional/off by default
- personal bank:
  - much narrower scope
  - usually no session scope
  - possibly no agent scope unless explicitly needed

The important part is that each bank can have its own retention mission and observation policy.

## Implementation targets

Likely files to change:

- `src/extensions/memoryExtension.ts`
  - support multiple banks
  - split recall/injection by role
  - split retain routing by role
  - add source-aware receipts/traces
- `src/config/schema.ts`
  - add a bank topology config block
- `src/config/loadConfig.ts`
  - normalize split-bank config and defaults
- `src/env.ts`
  - add explicit env overrides for personal/procedural bank ids if needed
- `pi-agent.json`
  - define the default split-bank shape
- `.env.example`
  - document procedural vs personal bank env vars
- `README.md`
  - document the split-bank setup and role behavior

## Migration plan

### Phase 1: config replacement

- replace the single-bank assumption with explicit procedural + personal bank config
- create brand-new banks with explicit ids
- define both bank ids and their role policies directly
- keep the procedural bank as the primary work bank and the personal bank as the corroborator preference bank
- if needed, synthesize durable facts from the current bank into the new banks as a separate migration step

### Phase 2: role-based injection split

- corroborator recalls procedural + personal
- working peers recall procedural only
- memory receipts and traces record which bank(s) were used

### Phase 3: retain routing split

- route all-agent work transcripts to procedural bank
- route curated personal facts to personal bank
- keep the personal bank narrow and deliberate

### Phase 4: cleanup

- update docs and examples to show split-bank mode as the standard setup
- remove legacy single-bank assumptions from the implementation path

## Acceptance criteria

- Corroborator sessions recall from both banks when split-bank mode is enabled.
- Working peers only receive procedural memory injection.
- Personal memory does not appear in peer prompts.
- Procedural memory remains the default work memory for all agents.
- The implementation cleanly supports the split-bank model without preserving a parallel single-bank runtime path.
- Memory receipts/traces clearly show which bank sourced each injection/retain event.

## Resolved decisions

1. Memory retention is automatic through Hindsight for both banks; pruning / cleanup happens later through the memory peer or equivalent review workflow.
2. The corroborator recalls **personal first**, then procedural.
3. Bank ids are explicit and stable:
   - `pi-ghosty-procedural`
   - `pi-ghosty-personal`
4. Split-bank mode is inferred from config / the presence of both banks; there is no separate mode flag.

## Recommendation

Use the smallest safe split:

- create brand-new procedural and personal banks with the explicit ids above
- keep the current procedural-style work-memory behavior, but move into the two new banks instead of maintaining a single shared bank
- inject personal memory only into the corroborator
- keep all working peers procedural-only
- let the two Hindsight banks carry different missions and observation rules

That gives you clean working contexts without losing durable preference memory for orchestration.
