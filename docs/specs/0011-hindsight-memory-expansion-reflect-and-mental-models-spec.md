# Spec: Hindsight memory expansion with reflect and mental models for split banks

## Problem

The current memory work in `pi-ghosty` is focused on retain, recall, tags, scopes, and bank separation.

That is necessary, but it is still only part of the Hindsight system.

Hindsight documentation describes a fuller hierarchy:

1. **Mental Models** — user-curated saved reflect responses, checked first
2. **Observations** — consolidated durable knowledge
3. **Raw Facts** — world/experience memory as ground truth

For Ghosty's goals, that hierarchy matters.

The desired memory behavior is not just:

- store facts
- retrieve facts
- inject facts

It is:

- retain broad memory within explicit constraints
- let Hindsight consolidate durable knowledge over time
- allow the system to answer recurring questions through `reflect()` when reasoning is needed
- use **mental models** for high-value, repeated, slowly-changing knowledge surfaces across the two-bank setup
- make agents smarter over time without collapsing memory into a glorified checkpoint or prompt cache

This spec defines how to expand Ghosty's Hindsight integration to include **reflect** and **mental models** in a way that is aligned with the docs and with the already-defined two-bank memory shape.

## Scope

In scope:

- how `reflect` should be used in Ghosty
- when Ghosty should keep using `recall` instead of `reflect`
- how mental models should be introduced for the two-bank setup
- mental model tag and scope strategy for personal vs procedural banks
- refresh strategy, triggers, and visibility rules for mental models
- which bank-level Hindsight config should be surfaced in `pi-agent.json`
- how to keep the expansion aligned with Hindsight docs rather than repo-specific reinvention
- observability for reflect and mental model operations

Out of scope:

- replacing prompt injection with full-time reflect everywhere
- creating one giant mental model for everything
- using custom retain as part of this expansion
- deleting or migrating existing banks as part of this spec itself
- changing the basic two-bank topology defined by the memory optimization spec

## Relationship to existing specs

This spec builds on:

- `docs/specs/0010-hindsight-doc-aligned-memory-optimization-spec.md`

Spec 0010 defines the ingest, tag, scope, and recall baseline.

This spec adds the next Hindsight-native layers:

- `reflect()`
- mental models

The two specs should be implemented together as one coherent Hindsight operating model.

## Hindsight doc anchors

This spec is based on the following documented Hindsight behaviors:

- `reflect()` is an **agentic reasoning loop**, not simple retrieval
- reflect uses **hierarchical retrieval**:
  - mental models first
  - observations second
  - raw facts third
- reflect is appropriate when the system needs a **reasoned answer**, not just returned data
- mental models are **saved reflect responses** for repeated/common queries
- mental models should be **narrow and scoped**, not giant "everything" summaries
- tags on a mental model filter both:
  - which memories are used to build it
  - which reflect calls can see it
- Hindsight supports automatic mental model refresh after consolidation
- Hindsight docs recommend using `include.facts=True` for reflect auditing in production and `include.tool_calls=True` only during development

## Requirements

### 1) Keep `recall` and `reflect` as distinct tools with distinct jobs

Per Hindsight docs:

- **recall** returns data
- **reflect** returns a reasoned answer

Ghosty must preserve that distinction.

Required behavior:

- normal memory injection remains primarily a `recall` concern
- `reflect` must be introduced as a separate reasoning path, not as a silent replacement for all recall
- Ghosty must only use `reflect` when it actually wants Hindsight to reason over memory and produce an answer

This spec rejects the idea of replacing all prompt memory injection with reflect.

### 2) Reflect must be used for reasoning-oriented memory tasks, not for every turn

Per Hindsight docs, `reflect()` is best when:

- multi-step reasoning is needed
- the answer should be disposition-consistent
- the bank should synthesize across mental models, observations, and facts
- grounded citations are useful

Ghosty should therefore use reflect for tasks like:

- summarizing what the system should know about the user before a complex planning turn
- summarizing cross-project work patterns or recurring engineering constraints
- generating a stable, grounded answer to recurring memory questions
- manual or background synthesis of memory into a reusable artifact

Ghosty should **not** use reflect as the default first step on every single user turn.

Reason:

- the docs distinguish reflect from recall for latency, control, and cost reasons
- Ghosty still needs raw recall for normal prompt augmentation and auditability

### 3) Mental models must be narrow, scoped, and dimension-specific

Hindsight docs are explicit:

- mental models are pre-computed reflect responses
- they should be created for repeated/high-value/slowly-changing queries
- they should be narrow and scoped
- "one mental model for everything" is an anti-pattern

Required Ghosty position:

- create multiple narrow mental models, not one giant bank summary
- each mental model must correspond to one clear knowledge dimension
- each model's tag surface must line up with the bank's tag/scoping strategy

### 4) Personal and procedural banks need different mental model sets

The two-bank topology implies two different families of mental models.

#### 4a) Personal bank mental models

Purpose:

- durable user-centered knowledge that should improve Ghosty's work with Seth over time

The personal bank is broad personal memory, not just "Seth alone" in isolation.

It should be able to learn about:

- Seth's preferences
- recurring interaction rules
- workflow habits
- stable constraints
- relevant people in Seth's life
- durable situations around Seth that matter for future interactions

Recommended initial personal mental model set:

1. **User Working Style**
   - source query: summarize Seth's recurring working style, preferences, and interaction rules
   - tags: `user:seth`

2. **User Constraints and Ongoing Realities**
   - source query: summarize durable constraints, persistent life/work pressures, and recurring realities around Seth that affect how the assistant should help
   - tags: `user:seth`

3. **User Personal Context**
   - source query: summarize durable personal context that matters for future interactions, including recurring people and situations around Seth
   - tags: `user:seth`

These should remain separate because Hindsight docs recommend one model per knowledge dimension.

#### 4b) Procedural bank mental models

Purpose:

- reusable engineering memory across projects
- project-specific continuity where needed

Per Spec 0010, the procedural bank has two observation surfaces:

- `domain:software`
- `project:pi-ghosty`

That means procedural mental models should also separate broad reusable knowledge from project-local knowledge.

Recommended initial procedural mental model set:

1. **Software Work Patterns**
   - source query: summarize recurring engineering workflow patterns, implementation habits, debugging strategies, and reusable operating knowledge across software work
   - tags: `domain:software`

2. **Pi-Ghosty Current System Shape**
   - source query: summarize the current architecture, operating constraints, memory behavior, and recurring implementation patterns specific to pi-ghosty
   - tags: `project:pi-ghosty`

3. **Pi-Ghosty Open Problems**
   - source query: summarize the current unresolved issues, fragile areas, and recurring blockers specific to pi-ghosty
   - tags: `project:pi-ghosty`

4. **Reusable Tooling and Workflow Knowledge**
   - source query: summarize reusable workflow/tooling knowledge that should help future software implementation work beyond a single repo
   - tags: `domain:software`

These models intentionally split reusable cross-project knowledge from project-specific continuity.

### 5) Mental model tags must follow Hindsight's documented visibility semantics

Per Hindsight docs:

- tags on a mental model filter both the source memories used during refresh and the visibility during reflect

Required behavior:

- personal mental models must use the personal bank's broad tag surface: `user:seth`
- procedural cross-project mental models must use the broad work surface: `domain:software`
- procedural repo-specific mental models must use the project surface: `project:pi-ghosty`

This keeps mental models aligned with the bank's intended memory surfaces.

This spec does **not** recommend adding agent/session tags to mental models by default.

### 6) Reflect must respect the same broad-memory philosophy as retain/recall

Ghosty's goal is:

- let Hindsight remember broadly within constraints
- let Hindsight consolidate and retrieve smartly later
- avoid pre-deciding importance too aggressively in the frontend

Reflect should follow the same philosophy.

Required behavior:

- do not build reflect around tiny, over-filtered memory surfaces
- do not scope reflect only to session-local artifacts
- use the documented broad surfaces:
  - personal: `user:seth`
  - procedural reusable: `domain:software`
  - procedural project-local: `project:pi-ghosty`

That gives Hindsight enough room to use its hierarchy properly.

### 7) Bank-level reflect configuration must be visible and adjustable

Hindsight docs expose reflect-specific configuration and dispositions.

Required Ghosty config surface:

For each bank, any reflect-related configuration that Ghosty intentionally sets must be visible in `pi-agent.json` if it can live there, or otherwise documented durably if it must remain server-side.

Recommended visible config surface under each bank:

```json
{
  "reflect": {
    "mission": "...",
    "sourceFactsMaxTokens": -1,
    "disposition": {
      "skepticism": 3,
      "literalism": 3,
      "empathy": 3
    }
  }
}
```

#### Personal bank reflect guidance

Reflect mission should help the bank reason about:

- how to work effectively with Seth
- which durable user context matters
- how to interpret personal context without overreacting to transient state

Recommended personal reflect posture:

- balanced skepticism
- moderate literalism
- somewhat higher empathy than procedural

#### Procedural bank reflect guidance

Reflect mission should help the bank reason about:

- software implementation
- engineering tradeoffs
- recurring workflow/tooling knowledge
- repo/project-specific system shape where relevant

Recommended procedural reflect posture:

- moderately higher skepticism
- moderately higher literalism
- lower empathy than personal

This follows Hindsight's documented distinction between reflect mission/disposition and retain/observations missions.

### 8) Reflect auditing should be available and explicit

Per Hindsight docs:

- `include.facts=True` is useful in production for transparency/auditing
- `include.tool_calls=True` is useful during development/debugging only

Required Ghosty behavior:

- if/when Ghosty introduces reflect into runtime flows, it must support an auditable mode that records:
  - the reflect answer
  - the `based_on` evidence
  - which bank was queried
  - which tags were used
- development/debug flows may also record reflect tool calls
- default user-facing production operation does not need the full internal tool trace unless explicitly enabled

### 9) Mental model refresh strategy must follow Hindsight docs

Per docs:

- mental models can refresh manually
- mental models can refresh automatically after consolidation
- `full` vs `delta` refresh modes are supported
- narrow scoped models are preferred

Required Ghosty refresh strategy:

#### Personal bank

Recommended:

- automatic refresh after consolidation for stable profile-style models
- keep models narrow so refresh cost stays reasonable

Good candidates:

- user working style
- user constraints and ongoing realities

#### Procedural bank

Recommended split:

- `domain:software` models: refresh after consolidation if they are long-lived reusable summaries
- `project:pi-ghosty` models: refresh after consolidation for current-system summaries if they are actively used
- allow manual refresh for curated models where changes should be reviewed first

Refresh mode guidance:

- default to `full` first, because it is the simpler documented baseline
- use `delta` refresh only for long-lived structured mental models where document stability matters and we explicitly want section-by-section updates

This spec does **not** require `delta` mental model refresh in phase 1.

### 10) Mental models must not replace observations

Per Hindsight docs, the retrieval order is:

- mental models
- observations
- raw facts

Required behavior:

- mental models are an additional curated/top-layer memory surface
- they do not replace observations
- they do not justify disabling or flattening the underlying observation system

Ghosty should rely on Hindsight's hierarchy as documented.

### 11) The expansion must preserve broad memory, not collapse into one project silo

This is a core repo requirement.

Required behavior:

- personal memory remains broad on `user:seth`
- procedural memory includes both broad reusable software memory and project-local continuity
- mental models reinforce that split rather than collapsing everything into `project:pi-ghosty`

That is how the memory can become useful for future projects instead of acting like a repo-local checkpoint.

## Recommended target configuration

### `pi-agent.json` expansion surface

Under each bank, add a visible Hindsight expansion block such as:

```json
{
  "hindsight": {
    "retainExtractionMode": "concise",
    "retainMission": "...",
    "observationsMission": "...",
    "reflect": {
      "mission": "...",
      "sourceFactsMaxTokens": -1,
      "disposition": {
        "skepticism": 3,
        "literalism": 3,
        "empathy": 4
      }
    },
    "mentalModels": [
      {
        "id": "user-working-style",
        "name": "User Working Style",
        "sourceQuery": "Summarize Seth's recurring working style, preferences, and interaction rules.",
        "tags": ["user:seth"],
        "maxTokens": 1200,
        "trigger": {
          "refreshAfterConsolidation": true,
          "mode": "full"
        }
      }
    ]
  }
}
```

This is a repo-level config expression of documented Hindsight features.

### Personal bank expansion target

- reflect mission: user-centered, durable-context-aware
- mental models on `user:seth`
- automatic refresh for high-value profile models
- no session-based mental models by default

### Procedural bank expansion target

- reflect mission: engineering/system/workflow reasoning
- mental models split across:
  - `domain:software`
  - `project:pi-ghosty`
- cross-project models must exist on the broad domain surface
- project-specific models remain separate

## Proposed runtime behavior

### 1) Keep normal turn-start memory injection based on recall

Default turn-start memory should remain recall-based, per Spec 0010.

Reason:

- cheap enough for normal loops
- keeps raw memory available to the model
- preserves control over prompt shape

### 2) Add explicit reflect pathways

Reflect should be introduced through explicit paths such as:

- a corroborator tool/command to ask Hindsight for a reasoned memory answer
- a background or pre-turn synthesis step for selected situations
- a debugging/evaluation command to compare recall vs reflect output

Examples:

- "What should I remember about Seth before planning this work?"
- "What recurring engineering patterns matter here?"
- "What is the current pi-ghosty system shape?"

### 3) Allow mental models to participate automatically through reflect

Per Hindsight docs, reflect checks mental models first automatically.

So Ghosty does **not** need to manually inject mental models into prompts as a separate bespoke layer if it is already calling reflect.

Required behavior:

- when Ghosty uses reflect on a bank, it should let Hindsight's own hierarchy run
- Ghosty should not reimplement a parallel mental-model selection system unless a future spec proves it necessary

## Implementation plan

### Phase 1: config surface expansion

Add visible config shape in `pi-agent.json` for:

- per-bank reflect mission
- per-bank reflect dispositions
- per-bank reflect source-facts token policy
- per-bank mental model definitions

Update schema accordingly.

### Phase 2: bank config application tooling

Extend the existing Hindsight config sync tooling so repo config can apply:

- reflect mission
- dispositions
- other supported reflect bank settings

Keep the source of truth visible in repo config.

### Phase 3: mental model seed/sync tooling

Add a script that can:

- create missing mental models from `pi-agent.json`
- refresh existing ones
- list drift between configured vs actual mental models

This should be the mental-model equivalent of the bank config sync path.

### Phase 4: reflect integration

Add a Ghosty path that can invoke `reflect` against:

- personal bank
- procedural bank

with explicit tag surfaces matching the bank design.

This path must support:

- audit mode (`include.facts`)
- debug mode (`include.tool_calls`)

### Phase 5: receipts and traces

Add reflect receipts/traces under the existing runtime artifact tree so runs can show:

- query
- bank
- tags
- answer
- based_on citations
- tool trace when debug-enabled

### Phase 6: mental model rollout

Seed the initial narrow mental model set for both banks and validate:

- cross-project procedural knowledge actually lands on `domain:software`
- project-local continuity lands on `project:pi-ghosty`
- personal durable knowledge lands on `user:seth`

## Constraints

- Do not replace recall everywhere with reflect.
- Do not create one mental model for everything.
- Do not use agent/session tags as the default mental model scope.
- Do not build project-only procedural mental models and call that "memory expansion."
- Do not introduce custom retain as part of this expansion.
- Do not hide reflect/mental-model config drift outside repo-visible surfaces.

## Acceptance Criteria

### A. Config visibility

- reflect-related bank config is visible in `pi-agent.json` or documented durably if it cannot live there
- mental model definitions for the initial rollout are visible in repo config/docs

### B. Reflect behavior

- Ghosty can call reflect explicitly on either bank
- reflect receipts show grounded evidence (`based_on`) when audit mode is enabled
- reflect debug mode can capture tool traces when needed

### C. Mental model behavior

- personal mental models exist on `user:seth`
- procedural mental models exist on both `domain:software` and `project:pi-ghosty`
- the system does not rely on a single giant summary model
- mental model refresh behavior is explicit and documented

### D. Cross-project memory expansion

- procedural memory can accumulate reusable software knowledge across projects via the `domain:software` surface
- project-specific knowledge still remains available on `project:pi-ghosty`
- personal memory continues to broaden around Seth and relevant people/situations in Seth's life

### E. Doc alignment

- the design clearly follows Hindsight's documented hierarchy:
  - mental models
  - observations
  - raw facts
- reflect is used for reasoning, not mistaken for recall
- mental models are narrow and scoped, not giant catch-alls

## Open Questions

1. Should Ghosty introduce one corroborator-facing reflect command first, or wire reflect into an internal pre-planning path immediately?

2. Which personal mental model should be seeded first:
   - user working style
   - user constraints and ongoing realities
   - user personal context
   if we want the smallest useful rollout?

3. Should procedural reflect default to the broad `domain:software` surface first, with project-specific reflect only when explicitly requested, or should corroborator flows query both by default?

4. When `includeChunks` is enabled in recall for normal flows, does that reduce the need for some reflect calls, or do the two remain distinct enough in practice that both are still needed?
