# Spec: Hindsight doc-aligned memory optimization for local-model Ghosty

## Problem

pi-ghosty needs a memory setup that gets the best possible behavior from local models **without** departing from Hindsight's recommended operating model.

The current pain is not just "memory exists" or "memory is too large." The pain is more specific:

- local models retain too much conversational noise even when retain missions are present
- near-duplicate facts and noisy observations eventually get recalled back into the prompt
- personal and procedural memory can bleed into each other if bank identity is expressed only through mission wording
- observation scopes are currently under-specified and have been used more like a throttle than a semantic control surface
- frontend retain payload shape has included runtime/application noise that Hindsight docs do not recommend feeding into retain
- configuration experimentation has drifted away from a clear "what Hindsight recommends" baseline

The target outcome is:

- keep Hindsight operating in its recommended mode
- keep memory rich, not neutered
- improve fact quality at ingest by making inputs, bank identity, tags, and scopes line up with Hindsight docs
- use scopes to create the *right observation surfaces*, not to choke memory volume artificially
- make Ghosty's memory config auditable against Hindsight docs and changelog-backed behavior

## Scope

This spec defines the doc-aligned target shape for Ghosty's Hindsight integration.

In scope:

- Hindsight version/runtime expectations
- frontend retain payload shape
- `document_id` / `update_mode` behavior
- tag strategy per bank
- observation scope strategy per bank
- bank mission / observation mission usage
- recall defaults for normal interactive use
- optional Hindsight features that are recommended by docs for shape control and filtering
- repo config and scripts needed to express the recommended setup
- evidence/validation plan for proving the system is behaving closer to Hindsight's intended model

Out of scope:

- inventing a custom retain prompt layer
- overriding Hindsight's extraction logic with `custom`
- replacing Hindsight with a bespoke memory system
- inventing repo-specific memory heuristics that contradict the docs
- deleting existing banks or pruning history as part of this spec itself

## Requirements

### 1) Use Hindsight the way the docs recommend first

Ghosty must treat the following as the baseline, in this order:

1. **clean input shape**
2. **stable document ids**
3. **correct update mode semantics**
4. **meaningful context**
5. **explicit tag strategy**
6. **explicit observation scopes**
7. **retain mission**
8. **observations mission**
9. optional classification/filtering features like entity labels

This ordering comes directly from the docs' emphasis on best practices, retain input shape, tags, scopes, and missions.

Ghosty must not jump immediately to `retain_extraction_mode=custom` when working inside the normal Hindsight path.

### 2) Keep `retain_extraction_mode=concise` as the default operating mode

Per Hindsight docs:

- `concise` is the default and recommended general-purpose selective mode
- `retain_mission` is the recommended starting point for steering extraction
- `custom` is reserved for replacing extraction rules entirely

Required behavior:

- Ghosty must default both banks to `retain_extraction_mode = "concise"`
- any optimization pass must first exhaust doc-recommended structural fixes before considering `custom`
- this spec assumes we are optimizing around `concise` + missions, not replacing the system

### 3) Feed Hindsight full cleaned transcripts, not runtime blobs

Hindsight docs explicitly recommend passing the richest structured representation available for conversations and explicitly prefer conversation JSON with role/content/timestamp structure.

Required frontend retain shape:

- retain payloads must be built from the **full cleaned transcript** relevant to that bank
- the transcript shape must be clean structured JSON, not application runtime event dumps
- do not retain provider names, model ids, usage accounting, response ids, text signatures, transport metadata, or other runtime bookkeeping unless a future spec explicitly proves they are useful memory content

Required cleaned transcript fields:

- `role`
- `content`
- `timestamp`

Allowed additional procedural transcript entries:

- tool call / tool result entries when they contain real procedural facts worth retaining

Bank-specific cleaned transcript policy:

- **procedural bank** receives the full cleaned working transcript, including tool activity that carries procedural/system/task facts
- **personal bank** receives the cleaned conversational transcript without tool activity

This is still a "full transcript" approach. The cleaning step removes runtime/application noise; it does not pre-summarize the conversation or pre-decide what facts should be kept.

This is the single most important frontend alignment requirement in this spec.

### 4) Use stable, meaningful `document_id` semantics exactly as documented

Per Hindsight docs:

- use stable document ids
- same document id supports idempotent reprocessing/upsert behavior
- `replace` is for re-sending the full updated content
- `append` is for sending only the new delta

Required behavior:

- each bank must have its own stable `document_id` namespace
- Ghosty must not share one ambiguous document id across both personal and procedural banks
- if Ghosty sends the **full updated transcript**, it must use `update_mode = "replace"`
- if Ghosty sends **delta-only transcript entries**, it must use `update_mode = "append"`
- the implementation must make this distinction explicit and auditable in receipts

Required optimization direction:

- Ghosty should support **true delta append** as the preferred long-conversation optimization path
- Ghosty must only use `append` when it can prove it is sending a non-overlapping cleaned delta for that bank
- if the append cursor is missing, uncertain, or invalid, Ghosty must fall back to a full cleaned transcript with `replace`

Append contract for Ghosty:

- maintain a per-bank append cursor/state
- procedural and personal banks may have different deltas because their cleaned transcript policies differ
- only new transcript entries since the last successful retain may be sent in append mode
- no overlap, replay, or partial-tail ambiguity is allowed in append mode

This keeps append as a real Hindsight optimization rather than a fuzzy approximation.

### 5) Tags must express bank identity, not just session plumbing

Hindsight docs are explicit that tags are the visibility-scoping mechanism.

Required behavior:

- bank identity must be encoded primarily through tags, not left to missions alone
- recall filtering must use those tags consistently
- tags must be chosen so that the bank is queryable on the semantic surface the bank is actually for

Required procedural bank tag goal:

- scope memories to both a broad reusable work surface and any needed project surface
- examples: `domain:software`, `project:pi-ghosty`, and future topic tags only when they are actually useful
- the broad work/domain tag is what allows cross-project learning and reuse

Required personal bank tag goal:

- scope memories to the durable user surface
- examples: `user:seth` and optionally future user-level subscopes

Not required:

- agent/session tags as the primary long-term identity of the bank

Agent/session tags may still exist for auditability or special flows, but they must not be the only meaningful surfaces that observations can consolidate onto.

The guiding rule is:

- use few, broad tags when you want Hindsight to build broad reusable memory
- use custom observation scopes to decide which broad surfaces should accumulate observations
- do not confuse tags/scopes with importance filtering; missions remain the main steering surface for what should matter

### 6) Observation scopes must be used semantically, not as a bottleneck

Hindsight docs define `observation_scopes` as a way to control **which tag combinations get their own observation pass**.

This spec adopts that exact meaning.

Observation scopes must be used to answer:

- what durable surface should this memory contribute to?
- at what granularity do we want future recall to work?

They must **not** be used primarily as:

- a memory suppression hack
- a low-level recall budget hack
- an arbitrary cap substitute

#### 6a) Procedural bank scope requirement

The procedural bank is for project/system/work memory.

Required default procedural observation surfaces:

- a broad reusable work-memory surface must exist
- a project-level durable memory surface must also exist

Required default procedural scopes:

```json
[
  ["domain:software"],
  ["project:pi-ghosty"]
]
```

Meaning:

- all retained procedural memories contribute to one broad software/work observation stream for cross-project learning
- those same memories also contribute to one project-level observation stream for project-specific continuity
- this aligns with the docs' custom-scope guidance: choose the exact meaningful combinations you want observations built on

Optional future expansion, but not required by default:

- add additional custom scopes only when there is a clearly justified recall use case
- examples:
  - `["domain:software", "topic:workflow"]`
  - `["project:pi-ghosty", "topic:architecture"]`

The spec does **not** recommend `per_tag` by default for the procedural bank, because generic per-tag fan-out would cause observations on every incidental tag. The docs describe custom scopes as the right tool when you know the exact meaningful combinations and want to avoid unnecessary passes.

#### 6b) Personal bank scope requirement

The personal bank is for durable user-level knowledge.

Required default personal observation surface:

- user-level durable memory must exist

Required default personal scope:

```json
[["user:seth"]]
```

Meaning:

- personal observations accumulate on one broad personal surface centered on Seth
- this lets durable preferences, people in Seth's life, recurring situations around Seth, and long-lived personal patterns consolidate across sessions
- it avoids session-level fragmentation and avoids project tags dominating personal memory

Optional future expansion, but not required by default:

- a custom user+domain scope if a real retrieval use case appears later
- example: `["user:seth", "topic:workflow"]`

#### 6c) Session scope guidance

Per Hindsight docs, session scopes are useful when you want observations queryable at the session level.

For Ghosty's long-term memory goals, session-level observations are **not** recommended as the default surface for either bank.

Reason:

- session scopes create observations that are only reusable at session granularity
- Ghosty's stated goal is durable fact quality across time, not session-local observation piles

So the default spec position is:

- no session observation scope by default
- add session scopes only for a separately justified, session-analytics-oriented feature

### 7) Personal and procedural banks must be structurally different

The Hindsight docs recommend one bank per user or per agent/context as a common pattern and expect bank isolation to matter.

Ghosty's split-bank design must therefore be structural, not merely prompt-based.

Required differences between banks:

- different bank ids
- different stable document ids
- different tags
- different observation scopes
- different mission focus
- potentially different retain content policy if that policy is documented and justified

This is the minimum needed for the split to behave like true Hindsight bank separation.

### 8) Recall defaults and limiting knobs must stay aligned with Hindsight defaults unless explicitly justified

This spec does **not** endorse crippling recall or adding hidden throttles as the first-line fix.

Hindsight docs say:

- `mid` is the default balanced budget
- `low` is for simple high-frequency loops
- `include.chunks` and `include.source_facts` are disabled by default and should be enabled only when needed
- `types` filtering should match the purpose of the query

Required default recall position for Ghosty interactive use:

- keep `includeSourceFacts = false` by default
- keep `includeChunks = false` by default
- choose recall `types` based on real prompt needs, not as a panic reaction
- do not add extra repo-local limiting knobs that fight Hindsight's own shaping unless they are explicitly surfaced and justified

Recommended default baseline for coordinator live prompting:

- `types = ["observation", "world", "experience"]`
- `budget = "mid"`
- `includeSourceFacts = false`
- `includeChunks` is a configurable choice:
  - `false` if extracted facts are sufficient
  - `true` if local models benefit from richer raw context during recall

Reason:

- this remains close to Hindsight's normal retrieval model
- source facts stay off because docs position them as provenance/audit extras, not the default agent loop shape
- chunks are the doc-backed lever when the agent needs exact wording or surrounding source context
- if later evidence shows that observations-only works better for a particular coordinator mode, that can be introduced as a **mode**, not as the only global default

Required visibility rule:

- any per-bank override that affects Hindsight behavior and can reasonably live in app config must be visible in `pi-agent.json`
- if an override cannot live in `pi-agent.json` because it is server-side-only, it must be documented in a durable repo file with its exact value, scope, and reason
- Ghosty must not rely on hidden bank config drift

Required audit/debug path:

- Ghosty's receipts/debug commands must continue to expose the fuller raw shape so memory quality can be inspected without injecting source facts/chunks into normal prompts

### 9) Use entity labels if tag/scope separation is not enough

Hindsight docs explicitly recommend entity labels with `tag: true` when a bank contains semantically similar memories that serve different purposes and ranking alone cannot distinguish them.

This is the doc-backed next step if local models still retain too much samey noise inside a bank after payload, tag, and scope fixes.

Required spec position:

- entity labels are the preferred Hindsight-native mechanism for additional shape control inside a bank
- they are more doc-aligned than inventing frontend post-hoc suppression rules

Planned first candidate label groups for Ghosty, if needed after the structural pass:

#### procedural bank candidate labels

```json
[
  {
    "key": "memory_type",
    "description": "Classify procedural knowledge as durable operating rule, architectural decision, troubleshooting fact, workflow pattern, or transient chatter.",
    "type": "value",
    "tag": true,
    "optional": true,
    "values": [
      { "value": "rule", "description": "Durable operating rule or canonical guidance" },
      { "value": "decision", "description": "Architecture or implementation decision likely to remain useful" },
      { "value": "workflow", "description": "Recurring workflow pattern or team operating constraint" },
      { "value": "troubleshooting", "description": "Reusable troubleshooting fact or failure mode" },
      { "value": "noise", "description": "Non-durable or conversationally incidental content" }
    ]
  }
]
```

#### personal bank candidate labels

```json
[
  {
    "key": "memory_type",
    "description": "Classify personal memory as durable preference, recurring habit, interaction rule, stable constraint, or transient chatter.",
    "type": "value",
    "tag": true,
    "optional": true,
    "values": [
      { "value": "preference", "description": "Stable user preference" },
      { "value": "habit", "description": "Recurring user habit or working style pattern" },
      { "value": "interaction_rule", "description": "Durable instruction about how the assistant should work with the user" },
      { "value": "constraint", "description": "Stable recurring user constraint" },
      { "value": "noise", "description": "Ephemeral conversational content" }
    ]
  }
]
```

This spec does **not** require labels in phase 1, but it defines them as the official Hindsight-recommended next lever if scopes and missions are still insufficient.

### 10) Hindsight runtime should stay current enough to benefit from relevant memory fixes

The changelog reviewed for this work includes relevant improvements/fixes around:

- duplicate memory units during concurrent upserts
- retain/batch retain reliability
- observation read performance
- observation recall/entity continuity

Required runtime position:

- Ghosty should target Hindsight `0.6.0` or newer while this optimization pass is being evaluated
- receipts/debug tooling should record the effective server version used by active runs

This is necessary so we do not debug old-runtime behavior while claiming to evaluate the Hindsight-recommended path.

### 11) This spec rejects arbitrary low observation caps as a default recommendation

Hindsight docs expose `max_observations_per_scope`, but they define it as a cap that stops new observation creation once the limit is hit.

Required spec position:

- do not use small hard caps as the primary quality-control strategy
- leave `max_observations_per_scope` unset / default (`-1`) unless later evidence shows a real scale problem that warrants a cap
- if a cap is ever introduced, it must be surfaced as an explicit visible config choice rather than an opaque server-side tweak

Reason:

- the docs present it as a capacity guard, not a recommended quality filter
- using a tiny cap would be a repo-level heuristic, not a Hindsight best practice

### 12) This spec rejects using source facts or chunks in normal prompt injection by default

Per Hindsight docs:

- `include.source_facts` is for tracing observation provenance
- `include.chunks` is for exact wording / source quotation needs
- both are optional include paths, not default memory-loop settings

Required behavior:

- default live prompt injection must not include source facts or chunks
- Ghosty may continue to record them in debug tools or explicitly requested deep-inspection flows

This is a direct doc alignment point, not an anti-memory stance.

## Recommended target configuration

### Frontend retain contract

For both banks:

- content shape: structured cleaned transcript JSON
- core fields: role, content, timestamp
- minimal, generic `context`
- stable bank-specific document ids
- `update_mode = "append"` when sending true cleaned deltas
- `update_mode = "replace"` when falling back to full updated transcripts
- `async = true` for end-of-turn retain

Context rule:

- Ghosty should not stuff extra frontend interpretation into `context`
- use plain transcript/source labels such as "full transcript" or similarly neutral wording
- do not phrase the context like "here are personal facts to extract" or "here are procedural facts to extract"
- bank missions, tags, and scopes are the proper control surfaces for extraction focus

### Procedural bank target

- bank id: `pi-ghosty-procedural`
- retain extraction mode: `concise`
- content shape: full cleaned working transcript including tool activity with real procedural facts
- tags: `domain:software` and `project:pi-ghosty`
- default observation scopes: `[["domain:software"], ["project:pi-ghosty"]]`
- retain mission: focus on durable project/system/work facts
- observations mission: optional; if set, keep it aligned to durable project/system knowledge
- entity labels: optional phase-2 if needed

### Personal bank target

- bank id: `pi-ghosty-personal`
- retain extraction mode: `concise`
- content shape: full cleaned conversational transcript without tool activity
- tags: `user:seth`
- default observation scopes: `[["user:seth"]]`
- retain mission: focus on durable preferences, habits, interaction rules, recurring constraints, and relevant people/situations around Seth
- observations mission: optional; if set, keep it aligned to durable person-centric knowledge
- entity labels: optional phase-2 if needed

### Coordinator recall target

Doc-aligned baseline:

- budget: `mid`
- types: `observation`, `world`, `experience`
- source facts off
- chunks off
- query timestamp present
- personal bank recalled on `user:seth`
- procedural bank recalled on both `domain:software` and `project:pi-ghosty`

### Peer recall target

Doc-aligned baseline:

- procedural bank only
- same recall defaults as coordinator unless a later evidence pass justifies a different peer mode

## Implementation plan

### Phase 1: spec-aligned rollback of non-doc throttles

Bring the repo back to a doc-aligned baseline by removing panic-level throttles that are not part of Hindsight's recommended path.

Required rollback targets:

- low arbitrary observation caps
- over-tight global recall shrinking done as a volume hack
- any scope setup whose main function is to suppress memory instead of define semantic observation surfaces

Keep if already present and correct:

- clean transcript retain payloads
- Hindsight 0.6.0 alignment
- structural bank split support

### Phase 2: implement clean retain + exact document semantics

Required code behavior:

- frontend retains cleaned full transcripts per bank
- procedural retains include tool activity; personal retains do not
- bank-specific stable document ids
- explicit `append` semantics for true delta retain
- explicit `replace` fallback semantics for full-history resend when append state is uncertain
- receipts must record whether the payload is full-history or delta and which `update_mode` is being used
- append state must be tracked per bank so procedural/personal deltas cannot drift into each other

### Phase 3: implement doc-aligned bank identity

Required config behavior:

- personal bank tags/scopes centered on `user:seth`
- procedural bank tags include both `domain:software` and `project:pi-ghosty`
- procedural scopes build both a broad reusable work-memory surface and a project-specific surface
- remove dependence on agent/session tags as the primary durable identity surface

### Phase 4: implement scope surfaces exactly as intended

Required config behavior:

- procedural observation scopes: one broad reusable `domain:software` surface and one project-specific surface
- personal observation scope: user-level custom scope
- no session scope by default
- no generic `per_tag` fan-out by default

### Phase 5: return recall to a doc-aligned baseline

Required config behavior:

- live recall should use Hindsight-like normal retrieval, not a memory-starvation mode
- source facts/chunks remain off unless explicitly needed
- budgets/types should reflect normal use, not a suppression hack
- all bank-level and recall-related overrides must be visible in `pi-agent.json` when possible, or otherwise documented in a durable repo file

### Phase 6: optional entity-label pass if quality still drifts

Only after Phases 1–5 are validated:

- add Hindsight-native entity labels with `tag: true`
- classify memory shape directly at retain time
- use those tags to filter recall when a bank contains multiple kinds of durable knowledge that ranking alone cannot separate

This is the doc-backed next lever after missions/tags/scopes, not before them.

## Constraints

- Do not introduce `custom` retain in this spec.
- Do not use tiny `max_observations_per_scope` values as the first-line answer.
- Do not make session scope the primary long-term observation surface.
- Do not keep source facts/chunks in normal prompt injection by default.
- Do not keep feeding runtime event blobs into retain.
- Do not rely on mission text alone to separate banks.
- Do not use scopes as a disguised memory-off switch.

## Acceptance Criteria

### A. Frontend shape

- retain requests contain only cleaned transcript JSON fields appropriate for Hindsight docs
- procedural retains include tool activity; personal retains do not
- receipts clearly show bank-specific document ids, tags, scopes, payload mode, and update mode
- append is used only for true non-overlapping deltas
- replace is used only as the correctness fallback for full-resend cases

### B. Bank identity

- procedural memories are retained and recalled on both a broad software-domain surface and a project-specific surface
- personal memories are retained and recalled on a broad user-level surface
- the same turn does not rely on identical tag/scope structure across both banks

### C. Scope behavior

- procedural observations consolidate on both the broad `domain:software` surface and the project surface
- personal observations consolidate on the broad `user:seth` surface
- session-level observation fragmentation is absent by default
- scopes are explainable in terms of future recall semantics, not volume suppression

### D. Recall behavior

- live recall no longer injects source facts or chunks by default
- recall defaults are still rich enough to use Hindsight normally
- the system is not reduced to a tiny observation-only bottleneck unless a later separate spec justifies a new mode

### E. Runtime alignment

- active Hindsight server version is recorded and is 0.6.0+
- the repo/client config is aligned to that version

### F. Evidence of better quality

On a fresh run after cleanup/reset, receipts should show:

- fewer runtime/plumbing pseudo-facts
- fewer assistant-process meta-facts ("the assistant is guiding...", "the system is initializing...")
- clearer separation between personal and procedural recalled content
- observations that are queryable on the intended surfaces (`user:seth`, `project:pi-ghosty`)

## Open Questions

1. Should the personal bank retain full user+assistant conversational transcript by default, or should Ghosty keep the narrower cleaned conversational shape without tool activity as its long-term personal-memory policy?
   - docs support rich conversation JSON generally
   - this repo still needs to decide whether narrowing the personal transcript beyond removing tool activity is justified

2. Should Ghosty keep a single normal coordinator recall mode, or add explicit modes such as:
   - normal recall
   - deep inspection
   - observation-focused recall
   without changing the default baseline?

3. After the structural/tag/scope fixes, do we still need entity labels for memory-shape filtering, or do missions + clean input + proper scopes solve enough of the local-model noise problem?

4. Is there any Ghosty-specific procedural use case that truly requires a second procedural observation scope beyond `["project:pi-ghosty"]`?
   - if yes, it should be justified by a real recall question, not by intuition alone
