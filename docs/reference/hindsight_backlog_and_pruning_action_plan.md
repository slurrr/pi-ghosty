# Hindsight backlog and pruning action plan

## Purpose

This document captures the confirmed findings from the 2026-04-30 Hindsight investigation and turns them into an execution plan.

Scope:
- explain what the log actually showed
- separate confirmed behavior from suspected follow-up areas
- prioritize backend work first
- defer tuning knobs like batch sizes until after backend work and transcript-shaping work

Primary log reviewed:
- `/home/poop/runs/agentmux/logs/20260429-204634-pi-vera-memory.log`
- investigation window: line `2463` to end, with `worker.poller` noise filtered where useful

## Confirmed findings

### 1) Consolidation was not randomly looping

The log shows Hindsight intentionally re-queuing consolidation after hitting its per-round limit.

Evidence:
- `bank=pi-ghosty-personal hit round limit of 100 memories, ~251 remaining. Re-queuing consolidation.`
- `bank=pi-ghosty-procedural hit round limit of 100 memories, ~154 remaining. Re-queuing consolidation.`

Interpretation:
- the apparent “starting over” behavior was not, by itself, evidence of a loop bug
- Hindsight completed a consolidation round, stopped at the round cap, and queued a follow-up round

### 2) Backlog growth happened while consolidation was still processing

The more important issue is that new large retain batches landed while prior consolidation work was still ongoing.

This means the next consolidation round did not merely continue the old remaining work; in at least one case it started with a larger backlog because more unconsolidated facts had arrived.

Best evidence:
- procedural consolidation summary found `254` pending memories
- after processing `100` and re-queuing, the next round started with `total_unconsolidated=556`

Interpretation:
- the system was not just draining a fixed queue
- it was trying to drain a queue that was still being fed by additional large append retains

### 3) Append mode appears to have been active

The log showed append/delta behavior rather than simple full replace behavior.

Evidence patterns:
- `[append] Prepended ... chars from existing document ...`
- `[delta] Chunk diff: ... unchanged, ... changed, ... new`
- `DELTA RETAIN COMPLETE`

Interpretation:
- this session did not look like the earlier pre-append full-replace behavior
- however, append was still producing large changed/new chunk sets, so the resulting memory workload was still very large

### 4) The retained transcript became very large during a heavy tool-call session

The session contained large retains such as:
- `27,811` chars
- `165,607` chars
- `201,299` chars

And append prepended large existing document bodies, for example:
- `32,048` chars
- `233,348` chars

The delta results were also large, for example:
- `85 chunks` with `12 changed`, `72 new`
- `165 chunks` with `74 changed`, `80 new`

Interpretation:
- append was functioning, but the practical delta was still very large
- a tool-heavy transcript likely contributed substantial raw text into memory retain payloads
- transcript pruning/shaping remains an important follow-up area

### 5) Model reliability issues are real and visible in the log

This is not just a throughput problem.

Confirmed backend/model symptoms:
- many `retain_extract_facts` calls with extremely small outputs (`2`, `6`, `10` tokens or similarly tiny outputs)
- malformed structured output during consolidation:
  - `JSON parse error from LLM response`
  - `Unterminated string ...`
  - `Finish reason: abort`

Interpretation:
- the backend model/runtime showed reliability problems on extraction and structured consolidation
- this should be investigated on the backend side before low-level tuning in this repo

### 6) Final shutdown was operator initiated

The final shutdown in the log was caused by manually killing the server during investigation.

Interpretation:
- shutdown-related connection errors at the end of the log are not primary root cause signals
- they should not be over-weighted in analysis

## Working problem statement

The main issue is not a single “consolidation loop bug.” It is the interaction of:

1. expected round-limited consolidation re-queueing
2. additional large append-based retain work arriving before the backlog is drained
3. transcript growth driven by heavy tool output
4. backend model/runtime reliability problems during extraction and structured consolidation

## Priorities

Priority order for next work:

1. **backend verification and changes**
2. **confirm repo-side configuration is still correct**
3. **investigate transcript pruning / retention shaping**
4. **only then consider tuning knobs** such as batch size or source-fact token caps

## Action plan

---

## Phase 1 — verify repo-side behavior is still correct

Goal: avoid chasing backend issues if the request path or local config regressed.

### 1.1 Confirm retain is still append-based
- Verify fresh receipts/logs show:
  - `requestedUpdateMode: "append"`
  - `effectiveUpdateMode: "append"`
- Verify retain logs still show append markers:
  - `[append] Prepended ...`
  - `[delta] Chunk diff: ...`

Success criteria:
- append is confirmed active on fresh runs
- no evidence of fallback to replace semantics unless explicitly intended

### 1.2 Confirm request-shape fixes are still holding
- Check for any fresh warnings about ignored retain params
- Specifically ensure there are no new warnings like:
  - `Unknown parameters ignored: [async]`
  - stale `update_mode` placement issues

Success criteria:
- no fresh retain-shape warnings in current logs

### 1.3 Confirm bank wiring is intentionally symmetric at the transcript level
- Verify that both banks are intentionally being fed the coordinator transcript
- Reconfirm that bank separation depends on missions/config, not different transcript routing

Success criteria:
- transcript routing behavior is understood and intentional

---

## Phase 2 — backend-first investigation

Goal: investigate the actual failure-prone area first.

### 2.1 Verify exact backend model/runtime configuration used by Hindsight
- Confirm the active provider/model used for extraction and consolidation
- Confirm how structured output is being requested through the OpenAI-compatible path
- Confirm retry behavior and any wrapper-specific settings that affect truncation/abort behavior

Questions to answer:
- Is the same model used for both extraction and consolidation?
- Are there backend-side stop/retry/JSON mode settings that can explain `finish reason: abort`?
- Are there provider-wrapper limits or bugs affecting structured output quality?

### 2.2 Investigate malformed structured-output handling
- Reproduce or inspect the conditions around:
  - `JSON parse error from LLM response`
  - `Unterminated string`
  - `Finish reason: abort`
- Determine whether the malformed JSON is caused by:
  - model instability
  - wrapper truncation
  - token/stop behavior
  - insufficient retry normalization

Success criteria:
- a concrete explanation exists for malformed structured responses
- a backend-side mitigation path is identified

### 2.3 Investigate near-empty extraction outputs
- Review retain extraction calls with effectively empty outputs
- Determine whether backend logic currently treats tiny or degenerate outputs as valid
- Evaluate whether backend should mark such results as low-confidence, retry them, or reject them

Success criteria:
- the reason for frequent near-empty extraction outputs is understood
- backend policy for handling them is decided

### 2.4 Investigate consolidation scheduling / backlog behavior
- Review how new retain work interacts with already-running consolidation rounds
- Determine whether backend should:
  - allow immediate re-queue plus concurrent backlog growth
  - coalesce pending consolidation work
  - delay next consolidation rounds until a retain burst settles
  - serialize large-document consolidation more aggressively

Success criteria:
- a backend-side approach is chosen to reduce backlog amplification during heavy sessions

---

## Phase 3 — verify and map transcript growth

Goal: prove how much of the retained payload comes from tool-heavy transcript content.

### 3.1 Identify exactly which turns triggered huge retains
- Correlate large retain events with session turns and tool calls
- Focus on retains in the `165k–201k` char range from the investigated session

Questions to answer:
- Which user/assistant turns preceded the biggest retains?
- Which tool calls contributed the most raw text?

### 3.2 Confirm whether large tool outputs are retained verbatim
- Check whether raw `read`, `grep`, `find`, `bash`, or log outputs are entering the transcript as retained memory content
- Measure how much transcript volume comes from tool results versus normal conversation

Success criteria:
- exact transcript contributors are known, not guessed

### 3.3 Compare raw transcript growth against chunk-diff behavior
- For one or two heavy retains, measure:
  - transcript chars
  - prepended chars
  - chunk count
  - changed/new/unchanged chunk counts
- Check whether resumed-session or transcript-format behavior is causing more chunks to flip from unchanged to changed than expected

Success criteria:
- we understand whether payload growth is mostly from genuine new content, formatting churn, or replayed tool text

---

## Phase 4 — design transcript pruning / retention shaping

Goal: reduce retained transcript volume without breaking useful append semantics.

This is important, but should happen after backend investigation starts.

### 4.1 Define what should be summarized, truncated, or excluded
Candidates:
- giant raw file reads
- repeated directory listings
- long grep/find result dumps
- long logs pasted into assistant responses
- bulky tool outputs with little durable memory value

### 4.2 Decide where pruning should happen
Options:
- transcript-build time
- retain-payload-build time
- both

Considerations:
- preserve enough structure for memory usefulness
- avoid causing append/delta churn by changing formatting too aggressively

### 4.3 Add observability for retained transcript composition
For each retain, record:
- total transcript chars
- chars from user messages
- chars from assistant messages
- chars from tool outputs
- tool output count
- top largest included tool outputs

Success criteria:
- future investigations can see composition directly from receipts/logs

### 4.4 Prototype a conservative pruning policy
Initial policy should prefer:
- preserving tool intent and outcome summaries
- dropping or truncating low-value bulky raw output
- keeping exact outputs only when likely memory-relevant

Success criteria:
- a testable pruning policy exists without changing backend knobs yet

---

## Phase 5 — add supporting observability in this repo

Goal: make the next round of investigation cheaper.

### 5.1 Add a per-retain summary line in local logs/receipts
Recommended fields:
- bank
- document_id
- update_mode
- transcript chars
- transcript sha1
- tool-output chars included
- changed/new/unchanged chunk counts

### 5.2 Add a retained-transcript composition artifact
- Save a compact breakdown of what categories of text were retained
- Avoid dumping giant payloads unless explicitly needed

### 5.3 Add a raw-vs-pruned comparison mode
- For one session, compare:
  - raw retained transcript size
  - pruned retained transcript size
  - resulting chunk diff behavior

Success criteria:
- pruning can be evaluated with evidence, not guesswork

---

## Phase 6 — deferred tuning knobs

These are intentionally lower priority.

Do not start here.

Potential knobs to revisit later:
- `consolidation_llm_batch_size`
- `consolidation_source_facts_max_tokens`
- `consolidation_source_facts_max_tokens_per_observation`
- consolidation concurrency / worker slot settings

These should only be revisited after:
- backend model/runtime behavior is better understood
- transcript growth/pruning behavior is better understood
- repo-side retain behavior is reconfirmed as correct

## Recommended next sequence

1. Reconfirm append/request-shape behavior on a fresh small run
2. Inspect backend model/runtime settings actually used by Hindsight
3. Investigate malformed structured-output and near-empty extraction behavior on the backend
4. Trace which session turns/tool outputs caused the largest transcript growth
5. Design transcript pruning / retention shaping with observability
6. Only after that, evaluate deferred tuning knobs

## Short operator summary

If resuming later, the key takeaways are:
- append mode appeared active
- consolidation re-queueing was expected due to the 100-memory round limit
- the real operational issue was backlog growth during ongoing consolidation
- the log also showed real model/runtime quality issues:
  - malformed structured JSON
  - many near-empty extraction outputs
- backend investigation should happen before tuning batch sizes
- transcript pruning remains important because heavy tool output likely inflated retain payloads significantly
