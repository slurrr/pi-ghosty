# Shape Mode Testing Plan

Goal: compare models and prompt setups on the same shaping tasks without needing a live real-world session every time.

## What we are testing

We are not testing raw intelligence or coding ability.
We are testing whether the model can:
- stay exploratory
- avoid premature closure
- surface important variables
- ask useful questions
- keep the transcript clean enough to continue working from

## Test matrix

Start small.

Compare only these variables first:
- **Model**
  - frontier candidate
  - local candidate
- **Mode framing**
  - baseline corroborator behavior
  - corroborator + `/skill:shape-mode`

That gives a 2x2 matrix.
Do not add middleware yet.

## Test procedure

For each model/setup pair:

1. Start a fresh session.
2. If testing the skill path, load `/skill:shape-mode` before the prompt.
3. Paste one test prompt exactly as written.
4. Let the model answer once.
5. Give one fixed follow-up:  
   `keep shaping with me do not solve yet what are the biggest unknowns or tensions you see`
6. Score the two replies using the rubric below.
7. Repeat for all prompts.

Optional third turn if needed:
`good keep it exploratory what am i not accounting for yet`

## Scoring rubric

Score each category from 1 to 5.

### 1. Restraint
- **1** = rushes into a solution or implementation plan immediately
- **3** = partly exploratory but still tries to wrap things up too fast
- **5** = clearly stays in shaping mode and resists premature closure

### 2. Question quality
- **1** = generic filler questions
- **3** = some useful questions, some fluff
- **5** = sharp questions that materially improve the frame

### 3. Variable coverage
- **1** = misses major constraints or tradeoffs
- **3** = catches some meaningful variables
- **5** = surfaces the key tensions and unknowns without overexplaining

### 4. Transcript cleanliness
- **1** = bloated, fake-complete, or context-poisoning
- **3** = workable but noisy
- **5** = compact, easy to build on, leaves room for discovery

### 5. Felt collaboration
- **1** = feels like assistant theater
- **3** = mixed
- **5** = feels like the model is actually sitting with you and helping you think

### Bonus notes

After scoring, jot down:
- best line or move
- worst miss
- whether you would continue the conversation from this transcript

## Quick score sheet

Copy this block per run:

```md
Model:
Setup: baseline | shape-mode
Prompt:

Restraint: /5
Question quality: /5
Variable coverage: /5
Transcript cleanliness: /5
Felt collaboration: /5

Best move:
Worst miss:
Would continue from this transcript: yes | no
Notes:
```

## Standard test prompts

Use these exactly as written at first.
They are intentionally shaped to tempt the model into premature solving.

---

### Prompt 1 — corroborator behavior / tool-harness problem

```text
I am building an agent OS where the corroborator has access to a heavy tool harness. The problem is that frontier models keep trying to be helpful assistants and rush toward solutions, tool use, or fake-complete plans before the shape is actually clear. I want the corroborator to sit with me, ask exploratory questions, help me identify missing variables, and only move into action when I explicitly want that. I am open to skills, middleware, model switching, output budgets, or interaction protocols. Help me think through the shape of this problem slowly and do not solve it yet.
```

### Prompt 2 — workflow design / personal operating style

```text
I work best when I can think meticulously and pressure-test a system before acting, but most AI agents push too fast and create shallow certainty. I need an agent workflow that supports slow shaping, focused back and forth, and clean transitions into execution. I do not want a generic productivity system. I want something that fits how I actually work. Help me explore the variables and tensions without turning this into a final prescription yet.
```

### Prompt 3 — architecture tradeoff / model routing

```text
I am considering using one model for exploratory shaping and another for execution. Part of me wants one smart model that can do both with enough restraint, but part of me thinks mode-based routing is the only realistic answer. I want to think through the tradeoffs carefully before deciding. Help me map the decision space and the hidden costs instead of trying to pick a winner right away.
```

### Prompt 4 — product shaping / ambiguity tolerance

```text
I have an idea for a product that helps one person manage a fleet of AI peers, but I do not yet know whether the real value is delegation, memory, pacing, or interface design. I do not want a business plan yet. I want help figuring out what problem this product is actually solving and what assumptions I may be making too early.
```

### Prompt 5 — implementation shaping / premature coding risk

```text
I think I need to change my system so the corroborator behaves differently during planning conversations, but I do not want to jump into implementation and encode the wrong abstraction. Help me reason about what should be true before I touch code. Stay exploratory and help me make sure I am not about to overfit a hack.
```

## How to compare results

Look for repeated patterns, not perfect consistency.

Good signs:
- the model slows down naturally
- it does not try to close in one shot
- its questions open space instead of consuming it
- it names tensions you actually care about
- the second turn gets better instead of more rigid

Bad signs:
- it gives polished answers that feel done but are actually shallow
- it asks obvious questions that do not move the frame
- it becomes robotic when constrained
- it keeps trying to switch into action mode uninvited

## Decision rule after testing

After running the matrix, make only one decision:

- if the skill clearly improves frontier behavior enough, keep iterating the skill
- if the skill helps but the model still repeatedly jumps to closure, add middleware next
- if the local model gives better shaping despite being less capable, keep it as the default riffing model and switch later for action

Do not redesign the whole stack from one test round.
Just decide the next control surface.
