# Spec: Memory Calibration Runbook (v1)

## Problem
We have recently changed client-side Hindsight recall behavior in `pi-ghosty`:
- role-based memory profiles
- per-bank token budgets
- optional (disabled) `maxFacts` belt
- improved injection preamble framing “system memories”

We need a lightweight, repeatable plan to:
- run real sessions (with delegations + tool calls)
- confirm injection looks sane for corroborator and workers
- detect drift/noise regressions quickly
- identify the smallest tuning changes if needed

## Scope
In scope:
- running 1–2 real sessions with normal workflow (delegations + tools)
- inspecting receipts, injected blocks, and traces
- validating that recall budgets are actually applied per bank and per role
- capturing concrete follow-up tuning actions (token budgets, budget=low/mid/high, types/tags)

Out of scope:
- new evaluation harnesses
- server-side (Hindsight/vLLM) changes

## Preconditions
- `pi-agent.json` has memoryProfiles configured (`corroborator`, `worker`) and assigned to agents.
- Hindsight service is running and healthy.
- Memory operations are enabled (async retain/operations) as desired.

## Plan (Loose)

### Phase 0: Start-of-run sanity
1) Start `pi-ghosty` normally.
2) Confirm memory extension is active (memory receipts folder is being written).
3) In logs (or console debug), verify the resolved effective recall config prints expected per agent:
   - corroborator: bankMaxTokens personal=1536 procedural=1024, budget=mid, includeSourceFacts on (256), chunks off
   - workers: bankMaxTokens procedural=8192 personal=0, budget=high, includeSourceFacts on (4096), chunks on (8192)

### Phase 1: Do a real session (session #1)
Goal: representative corroborator usage.
- Have at least ~10–20 turns.
- Include:
  - normal conversational planning/riffing
  - at least a couple delegations (coder/researcher/reviewer)
  - at least a few tool calls by workers (read/grep/edit/write)

Record the session id(s) for later review.

### Phase 2: Do a second real session (session #2)
Goal: ensure repeatability under different topic/task shape.
- Similar duration.
- Try at least one deeper technical task that forces workers to use memory + tools.

### Phase 3: Post-run inspection (receipts + traces)

#### 3A) Inspect injected memory blocks (human-readable)
For each agent used in the run (at minimum: corroborator + 1 worker):
1) Open the latest injected block:
   - `runs/pi-ghosty/data/memory/receipts/<agent>/<sessionId>/latest-injected.md`
2) Verify:
   - preamble text is present and correct (“system memories … trusted background … call out conflicts”)
   - corroborator has **both** sections:
     - `memory_personal_bank ...`
     - `memory_procedural_bank ...`
   - workers have **procedural only**
   - chunks are not being dumped as raw text for corroborator

Capture:
- injected line counts and “feel” (too many micro-facts? too noisy?)

#### 3B) Inspect raw recall payloads (ground truth)
For the same turns, open:
- `runs/pi-ghosty/data/memory/receipts/<agent>/<sessionId>/turns/<turnId>/recall.json`

Verify:
- both banks were queried for corroborator and only procedural for workers
- the payload includes expected fields when `includeSourceFacts/includeChunks` are enabled
- no unexpected “reasoning/thinking” leakage in memory line texts

#### 3C) Inspect JSONL traces for recall health + timings
Open the agent trace:
- `runs/pi-ghosty/data/traces/<agent>/<sessionId>.jsonl`

Filter for `type=memory_recall` and confirm:
- per-bank recall calls appear as expected
- `ms` is within acceptable ranges
- `injectedLines` and `injectedChars` are stable and not exploding

Also confirm presence of:
- `memory_recall_skipped` events for banks with max tokens set to 0 (e.g. worker personal)

### Phase 4: Evaluate outcomes + decide tuning deltas
Evaluate qualitatively:
- corroborator: does it feel coherent and non-robotic?
- workers: does memory help or cause drift?

If corroborator is too noisy:
- first dial: lower personal bankMaxTokens (e.g. 1536 → 1024)
- second dial: lower procedural bankMaxTokens (e.g. 1024 → 768)

If workers are drifting / overloaded:
- first dial: lower procedural bankMaxTokens (e.g. 8192 → 4096)
- second dial: narrow `types` (e.g. observation-only)
- third dial: reduce `budget` from high → mid

If workers lack grounding:
- keep bankMaxTokens but verify `includeSourceFacts/includeChunks` are actually returned by Hindsight

## Acceptance Criteria
After 1–2 real sessions:
- corroborator injection is clearly smaller and more usable than the previous 60-fact wall, while preserving continuity
- workers demonstrably benefit from procedural recall (fewer repeated questions; better adherence to prior decisions)
- no major drift regressions attributable to over-injection
- traces/receipts provide enough evidence to justify any tuning change

## Notes / Follow-ups
- V2 concept (not required now): add a “deep worker” preset or per-delegation promotion if routine worker tasks prove too heavy at 8192.
