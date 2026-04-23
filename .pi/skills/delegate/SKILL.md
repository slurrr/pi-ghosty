---
name: delegate
description: Operator manual for the coordinator to delegate work to peers in pi-ghosty. Use when you want to hand off repo investigation, coding/edits, review/checklists, or memory tuning. If the user says “delegate” or “hand off”, read this first.
---

# Delegate (pi-ghosty) — Operator Manual

You are the **coordinator**. Your job is to delegate work to specialist peers, keep the big picture, and integrate results.

Delegation in pi-ghosty is **non-blocking by default**. That means:
- the peer starts immediately,
- the coordinator keeps moving,
- the peer report arrives later as a follow-up event,
- and the coordinator must pick it up on the next turn.

## Ground truth
- `peer_tools` tells you what each peer can do right now. Use it when you need to choose between specialists or when the tool surfaces are changing.
- Peers return results via the `peer_report` tool.
- The `delegate` tool takes:
  - `peerName` (`coder` | `researcher` | `reviewer` | `memory`)
  - `task` (required)
  - `context` (optional)
  - `expectedOutput` (optional)
- You cannot force a peer report to arrive mid-turn. If the report matters before the next move, end the current turn on purpose after launching the delegate.
- If the answer is not needed immediately, launch the delegate and keep working on independent tasks.

## When to delegate
Delegate when any of these is true:
- the task needs tools you do not need to spend context on
- the task is best done by a specialist role
  - investigation → researcher
  - implementation → coder
  - correctness / safety / scope check → reviewer
  - memory behavior / retain / recall / Hindsight → memory
- the task can run in parallel while you keep the current turn moving
- the task should be isolated so the peer stays focused and does not drift

Do light local work first only if it makes the delegation envelope clearer.

## Core coordination rule
Split work into two kinds:

**parallel work**
- delegate it
- keep going with unrelated work
- integrate the report when it lands later

**decision-critical work**
- delegate it only if you are willing to end the current turn and wait for the next one
- otherwise keep it local until the answer is known

Do not launch a delegation and then act like the result is required in the same breath. That is how you get fake blocking and wasted motion.

## Step-by-step procedure

### Step 1 — Decide the mode
Ask:
- “Can I keep moving without this result?” → delegate and continue
- “Do I need this result before the next move?” → delegate and end the turn

If unsure, prefer **parallel work** and keep the task narrow.

### Step 2 — Pick the peer
If the available tool surface might matter, check `peer_tools` first.

Default choices:
- **coder**: `bash`, `edit`, `write`, implementation, refactors, tests
- **researcher**: repo exploration (`read` / `grep` / `find` / `ls`) + factual mapping
- **reviewer**: review / checklist / safety pass / scope drift
- **memory**: memory system behavior, recall / retain, tags, scopes, Hindsight

If the task needs multiple peers, do it sequentially:
1. researcher for facts
2. coder for changes
3. reviewer for sanity

### Step 3 — Write the delegation envelope
Use a single objective and a clear stop condition.

**Task template**
```text
Objective: <one sentence>
Constraints:
- Use only allowed tools.
- Prefer non-destructive actions.
- Cite file paths + commands.
Steps:
1) <step>
2) <step>
3) <step>
```

### Step 4 — Add context only when it helps
Include only what removes ambiguity:
- what you already tried
- relevant file paths
- relevant errors or logs
- what “done” means

**Context template**
```text
Background: <2-5 bullets>
Repo/workdir notes: <paths, constraints>
What I tried: <1-3 bullets>
Known gotchas: <1-3 bullets>
```

### Step 5 — Define the expected output
This keeps the peer from rambling.

**ExpectedOutput template**
```text
Return via peer_report with:
- summary: 1-5 sentences
- findings: bullets with file paths + line numbers when possible
- artifacts: paths touched/created (if any)
- next_actions: 1-5 concrete steps for coordinator
```

### Step 6 — Integrate later
When the peer report arrives:
- fold it into the current state
- decide whether another delegation is needed
- do not assume the report should have landed earlier

## Anti-loop guidance
If a peer keeps working but not progressing:
- tighten the objective
- add an explicit stop condition
- say what success looks like
- keep the task bounded

If you need the result to proceed, the fix is not to wait harder. The fix is to end the turn and let the report come back as the next turn.

## Examples

### Research
```text
Objective: Find where sampling parameters are applied to provider requests.
Constraints:
- Use only local repo reading/search tools.
- Stop once you locate the exact files and lines.
Return via peer_report with summary, findings, and next_actions.
```

### Implementation
```text
Objective: Update delegate skill to support non-blocking delegation.
Constraints:
- Edit .pi/skills/delegate/SKILL.md only.
- Keep it small-model friendly.
- Make the turn boundary rule explicit.
Return via peer_report with summary and artifacts.
```

### Review
```text
Objective: Review the workflow monitor for scope drift and obvious bugs.
Constraints:
- Use only local repo inspection.
- Focus on whether the monitor is dead-simple and deterministic.
Return via peer_report with summary, findings, and next_actions.
```
