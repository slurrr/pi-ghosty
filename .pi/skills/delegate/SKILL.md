---
name: delegate
description: Operator manual for the coordinator to delegate work to peers in pi-ghosty. Use when you want to hand off repo investigation, coding/edits, review/checklists, or memory tuning. If the user says “delegate” or “hand off”, read this first.
---

# Delegate (pi-ghosty) — Operator Manual

You are the **coordinator** (user-facing). Your job is to **delegate execution** and then **integrate results**.

This skill tells you exactly how to use:
- `peer_tools` (internal tool): inspect each peer’s tool surface
- `delegate` (tool): send a task to one peer

## Ground truth (important)
- Peers return results via the `peer_report` tool.
- The `delegate` tool takes:
  - `peerName` (coder|researcher|reviewer|memory)
  - `task` (required)
  - `context` (optional)
  - `expectedOutput` (optional)
- **Session control:** the current runtime **does not let you force** “new vs resumed” peer sessions from the `delegate` tool. If a peer already has a session, it will usually be **resumed**.
  - If you want a “fresh” behavior anyway: explicitly tell the peer to **ignore prior context** and include a full recap in `context`.

## When to delegate (rules)
Delegate when any of the following is true:
1) The task needs tools you *don’t* have (or shouldn’t spend time on), especially heavy repo scanning.
2) The task is best done by a specialist role:
   - investigation → researcher
   - implementation → coder
   - correctness/safety/scope check → reviewer
   - memory behavior/tags/retain/recall policy → memory
3) The user explicitly says: “delegate”, “hand off”, “ask the researcher/coder/reviewer/memory”, etc.

You may do **light** local work first (a quick `ls/grep/find/read`) only to create a better delegation envelope.

## Step-by-step procedure

### Step 0 — Decide if this is a delegation moment
Ask yourself:
- “Is this execution work?” → delegate.
- “Is this synthesis/plan/integration?” → you do it.

If unsure, delegate.

### Step 1 — Call `peer_tools`
Do **not** guess. Call `peer_tools` to confirm what peers can do right now.

### Step 2 — Pick the peer (decision table)
Use this table (default choices):
- **coder**: needs `bash`, `edit`, `write`, implementation, refactors, tests
- **researcher**: needs repo exploration (`read/grep/find/ls`) + factual mapping
- **reviewer**: needs review/checklist/safety pass, spot regressions/scope drift
- **memory**: memory system behavior, recall/retain tagging, Hindsight usage

If the task needs multiple peers, do it sequentially:
1) researcher for facts → 2) coder for changes → 3) reviewer for sanity

### Step 3 — Session strategy (resume vs “fresh start”)
You can’t directly spawn a new peer session via `delegate`, so choose one:

**A) Resume-friendly task** (default):
- Same thread/topic
- Continuing incomplete work
- Peer’s context is likely still relevant

**B) “Fresh start” task** (simulate new):
Use when:
- New topic, unrelated to prior peer work
- Peer previously got confused / stuck / repetitive
- You need unbiased re-analysis

For “fresh start”, include in `context`:
- `FRESH START: Ignore prior conversation in this peer session. Treat this as a new task.`
- A compact recap + the current repo state needed

### Step 4 — Write a good delegation envelope
The envelope is `task` + optional `context` + optional `expectedOutput`.

#### 4.1 Task (required)
Task must be:
- single objective
- action-oriented
- scoped to what the peer can actually do

**Task template (copy/paste):**

```
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

#### 4.2 Context (optional but recommended)
Use context to eliminate ambiguity and prevent loops.
Include:
- what you already tried (brief)
- relevant file paths
- relevant errors/log snippets
- definitions (what “done” means)

**Context template:**

```
Background: <2-5 bullets>
Repo/workdir notes: <paths, constraints>
What I tried: <1-3 bullets>
Known gotchas: <1-3 bullets>
```

#### 4.3 Expected output (optional but recommended)
This is how you stop rambling and get a report you can integrate.

**ExpectedOutput template:**

```
Return via peer_report with:
- summary: 1-5 sentences
- findings: bullets with file paths + line numbers when possible
- artifacts: paths touched/created (if any)
- next_actions: 1-5 concrete steps for coordinator
```

### Step 5 — Call `delegate`
Send the envelope. Keep it short but unambiguous.

### Step 6 — Integrate and decide next delegation
After the peer returns:
- If you need more facts → delegate to researcher again (or fresh-start).
- If changes are needed → delegate to coder with precise file targets.
- If risk/quality matters → delegate to reviewer for checklist.

## Anti-loop guidance (coordinator-side)
If a peer is repeatedly calling a tool successfully but not progressing:
- That’s usually an ambiguous task / missing “stop condition”.
Fix it by delegating again with:
- a tighter objective
- explicit stop condition ("stop after you find X")
- explicit expectedOutput

## Examples

### Example: delegate repo investigation to researcher
- peerName: `researcher`
- task:
  - “Objective: Find where sampling parameters are applied to provider requests.”
- context:
  - “Search in src/ for samplingExtension + before_provider_request; cite files + lines.”
- expectedOutput:
  - “Return file paths + short explanation + next step.”

### Example: delegate implementation to coder
- peerName: `coder`
- task:
  - “Objective: Update delegate skill to be a step-by-step operator manual.”
- context:
  - “Edit .pi/skills/delegate/SKILL.md; keep it small-model friendly; include templates.”
- expectedOutput:
  - “Return summary + list of edits.”
