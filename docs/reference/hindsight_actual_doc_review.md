# Hindsight docs review → pi-ghosty best-practices (embedded local pg0)

Primary sources (in-repo Hindsight docs):

- `docs/Hindsight/skills/hindsight-docs/references/best-practices.md`
- `docs/Hindsight/skills/hindsight-docs/references/developer/configuration.md`
- Supporting: `docs/Hindsight/skills/hindsight-docs/references/developer/storage.md`, `.../developer/performance.md`, `.../developer/observations.md`, `.../developer/retrieval.md`

> Note on citations: these Hindsight docs live under `docs/Hindsight/...` which is typically gitignored. Repo tooling like `grep/find` may skip them, so **exact line numbers are not reliably obtainable** with the current inspection tools. Citations below reference file paths + section headings/anchors.

---

## 1) What the actual Hindsight docs recommend (high signal)

### 1.1 Banks are the isolation boundary

- A **bank** is the unit of isolation; ops are always per-bank; banks do not share data.
  - Source: `.../best-practices.md` → “Memory Banks”.

**Implication for pi-ghosty:** if you want hard separation between projects/users, do it via bank IDs (not just tags).

### 1.2 Retain: never pre-summarize; always supply context; stable document_id

- Preferred retain content format for conversations is **structured JSON**; plain-text is acceptable but worse.
  - Source: `.../best-practices.md` → “Retaining Data → Content Format”.
- **Always set `context`**; it has high impact on extraction quality.
  - Source: `.../best-practices.md` → “The `context` Field”.
- Use stable `document_id` for upsert semantics; do **not** generate a random UUID per call.
  - Source: `.../best-practices.md` → “The `document_id` Field”.
- Provide a `timestamp` when you have temporal context; omitting disables temporal ranking.
  - Source: `.../best-practices.md` → “The `timestamp` Field”.

**Implication for pi-ghosty:** our transcript-per-session approach aligns with stable `document_id`, but we should consider adding timestamps and (if possible) structured conversation JSON rather than flattened text.

### 1.3 Tags: naming conventions + strict matching for safety

- Tags are the primary filter mechanism; metadata is **not filterable**.
  - Source: `.../best-practices.md` → “Metadata Schema” + Anti-pattern “Using `metadata` for filtering”.
- Recommended tag naming patterns include `user:<id>`, `session:<id>`, `team:<name>`, `topic:<name>`, `scope:<name>`.
  - Source: `.../best-practices.md` → “Tags: Naming Conventions”.
- For multi-tenant safety, use strict tag match modes (`any_strict` / `all_strict`) to avoid leakage.
  - Source: `.../best-practices.md` → “Tag Filtering Modes” and Anti-pattern “`tags_match="any"` for multi-tenant banks”.

**Implication for pi-ghosty:** we should treat `HINDSIGHT_BANK_ID` as a serious isolation boundary and—if sharing a bank across multiple principals—use strict tag matching.

### 1.4 Observation scopes and missions are first-class controls

- Observations are produced asynchronously after retain; they’re included in recall/reflect and can be filtered by `types`.
  - Source: `.../best-practices.md` → Taxonomy (“Observations”).
  - Source: `.../developer/observations.md` → “Observations in Retrieval”.
- `observation_scopes` controls which tag combinations get separate observation passes.
  - Source: `.../best-practices.md` → “Observation Scopes”.
  - Source: `.../developer/observations.md` → “Observation Scopes”.
- You can redefine observation synthesis by setting an observations mission:
  - `HINDSIGHT_API_OBSERVATIONS_MISSION` (env) or per-bank config.
  - Source: `.../developer/configuration.md` → “Observations (Experimental)”.
  - Source: `.../developer/observations.md` → “Observations Mission”.

**Implication for pi-ghosty:** our current “durable scopes only” approach matches the docs’ recommendation to control scopes explicitly.

### 1.5 Recall: budget + max_tokens + query_timestamp

- Recall runs 4 strategies in parallel: semantic, keyword (BM25), graph, temporal; results fused and reranked.
  - Source: `.../best-practices.md` → “Recall” and `.../developer/retrieval.md`.
- Recall controls:
  - `budget` (low/mid/high)
  - `max_tokens` (memory return size)
  - `types` and `tags` filters
  - `query_timestamp` for time-anchored temporal ranking
  - Source: `.../best-practices.md` → “Recalling Memories” + `.../developer/retrieval.md`.

**Important hard limit:** `HINDSIGHT_API_RECALL_MAX_QUERY_TOKENS` defaults to 500; oversized recall queries are rejected with HTTP 400.
- Source: `.../developer/configuration.md` → “Retrieval”.

**Implication for pi-ghosty:** if we pass large prompts as recall queries, we can hit server rejection. We should shape/shorten recall queries.

### 1.6 Retain/recall timing: don’t do both in same turn

- Docs explicitly warn: “Do not retain and recall in the same turn” and recommend end-of-turn/session retain.
  - Source: `.../best-practices.md` → “Sync vs Async” + Anti-pattern “Retaining and recalling in the same request”.

**Implication for pi-ghosty:** our pattern (recall before response; retain at session end) is aligned.

---

## 2) Embedded local pg0: what the docs say + tradeoffs

### 2.1 pg0 is the default DB in development

- Hindsight uses PostgreSQL as sole storage.
  - Source: `.../developer/storage.md`.
- pg0 behavior:
  - If no database URL configured, starts embedded PostgreSQL on port 5555 and stores data in `~/.hindsight/pg0/`.
  - Source: `.../developer/storage.md` → “Development with pg0”.

### 2.2 Config knobs for DB

- `HINDSIGHT_API_DATABASE_URL` default: `pg0` (embedded).
- `HINDSIGHT_API_MIGRATION_DATABASE_URL` for migrations bypassing poolers.
- `HINDSIGHT_API_DATABASE_SCHEMA` default `public`.
- `HINDSIGHT_API_RUN_MIGRATIONS_ON_STARTUP` default `true`.
  - Source: `.../developer/configuration.md` → “API Service → Database”.

**Tradeoff:** pg0 is convenient; docs explicitly say it’s not recommended for production.

---

## 3) Compare against pi-ghosty current integration (only what matters)

pi-ghosty’s memory flow (code):

- Recall before agent start; tag filtered; injects memory lines into system prompt.
- Retain at agent end; stores a transcript; sets `document_id` and custom observation scopes.

Key alignment/mismatches against Hindsight best practices:

- ✅ Stable `document_id` (session-derived): aligns with `best-practices.md`.
- ✅ Doesn’t retain+recall in same request: aligns.
- ✅ Uses tags for filtering: aligns.
- ⚠️ Retain content is flattened plain text transcript, not structured JSON conversation: docs prefer JSON.
- ⚠️ No explicit `timestamp` on retain: docs recommend it for temporal ranking.
- ⚠️ Recall query may be too long vs `HINDSIGHT_API_RECALL_MAX_QUERY_TOKENS` default 500: docs warn server rejects oversized queries.

---

## 4) Recommended settings for pi-ghosty (three serving modes)

Below are **doc-backed** recommendations for the Hindsight API service env, plus how pi-ghosty should call it.

### Common defaults (recommended for all modes)

**Bank + tags** (from `best-practices.md`):

- Prefer 1 bank per isolation domain (per user or per project). If sharing, use strict tags.
- Use consistent tag naming. Suggested for pi-ghosty:
  - `project:pi-ghosty` (already)
  - `agent:<name>`
  - `session:<id>`
  - (optional) `scope:private` / `scope:shared`

**Retain request structure**:

- Always set `context` (already done).
- Use stable `document_id` (already done).
- Add a `timestamp` (doc-recommended).
- Avoid pre-summarization (we don’t summarize; good).

**Recall request structure**:

- Keep `budget=mid` as default; `low` for tight latency loops.
- Keep `max_tokens` conservative (e.g. 2048) and raise only for “research mode”.
- Shape/shorten the query to avoid the server query token limit.

**Observations** (`developer/configuration.md`):

- Leave `HINDSIGHT_API_ENABLE_OBSERVATIONS=true` unless you are debugging or optimizing ingestion cost.
- Set `HINDSIGHT_API_OBSERVATIONS_MISSION` to match your domain (technical decisions, architecture, errors) when default durable-knowledge synthesis is too generic.
- If observations grow unbounded, consider `HINDSIGHT_API_MAX_OBSERVATIONS_PER_SCOPE`.

---

## A) Frontier mode (quality first)

Use a strong structured-output LLM for retain/consolidation, and optionally a cheaper LLM for reflect.

Doc knobs:

- Per-operation LLMs (`developer/configuration.md` → “Per-Operation LLM Configuration”):
  - `HINDSIGHT_API_RETAIN_LLM_*`
  - `HINDSIGHT_API_CONSOLIDATION_LLM_*`
  - `HINDSIGHT_API_REFLECT_LLM_*`

Suggested env (example):

```bash
# DB: pg0 or external Postgres
export HINDSIGHT_API_DATABASE_URL=pg0

# Retain/consolidation on high-quality model
export HINDSIGHT_API_LLM_PROVIDER=openai
export HINDSIGHT_API_LLM_MODEL=gpt-4o
export HINDSIGHT_API_RETAIN_LLM_MODEL=gpt-4o
export HINDSIGHT_API_CONSOLIDATION_LLM_MODEL=gpt-4o

# Reflect (if used) can be cheaper/faster
export HINDSIGHT_API_REFLECT_LLM_MODEL=gpt-4o-mini

# Keep observations on
export HINDSIGHT_API_ENABLE_OBSERVATIONS=true
```

When to use: you care about extraction quality more than cost/latency.

---

## B) Local-only mode (privacy + simplicity)

Use embedded pg0 + local embeddings + local reranker.

Doc knobs:

- DB defaults (`developer/configuration.md` → “Database”): `HINDSIGHT_API_DATABASE_URL=pg0`.
- Embeddings default is `local` with `BAAI/bge-small-en-v1.5` (`developer/configuration.md` → “Embeddings”).
- Reranker default is `local` with `cross-encoder/ms-marco-MiniLM-L-6-v2` (`developer/configuration.md` → “Reranker”).

Suggested env (example):

```bash
export HINDSIGHT_API_DATABASE_URL=pg0

# LLM (for retain/reflect) can still be local OpenAI-compatible server
export HINDSIGHT_API_LLM_PROVIDER=openai
export HINDSIGHT_API_LLM_BASE_URL=http://127.0.0.1:8000/v1
export HINDSIGHT_API_LLM_API_KEY=dummy
export HINDSIGHT_API_LLM_MODEL=your-local-model

# Keep embeddings/reranker local and CPU-safe
export HINDSIGHT_API_EMBEDDINGS_PROVIDER=local
export HINDSIGHT_API_RERANKER_PROVIDER=local
export HINDSIGHT_API_RERANKER_LOCAL_MAX_CONCURRENT=4

# Faster startup
export HINDSIGHT_API_LAZY_RERANKER=true
```

Operational notes:

- Docs warn `trust_remote_code` flags are a security risk; keep them `false`.
  - Source: `developer/configuration.md` → Embeddings/Reranker “TRUST_REMOTE_CODE”.

---

## C) Hybrid mode (local storage + remote inference)

Keep DB local (pg0 or local Postgres), but use hosted services for embeddings and/or reranking and/or retain LLM.

Doc knobs:

- Embeddings providers (`developer/configuration.md` → “Embeddings”): `tei`, `openai`, `litellm-sdk`, etc.
- Reranker providers (`developer/configuration.md` → “Reranker”): `tei`, `cohere`, `openrouter`, `zeroentropy`, `litellm-sdk`, etc.

Suggested env (example):

```bash
export HINDSIGHT_API_DATABASE_URL=pg0

# LLM for retain can be Groq for throughput (docs recommend high-throughput for retain)
export HINDSIGHT_API_LLM_PROVIDER=groq
export HINDSIGHT_API_LLM_API_KEY=...
export HINDSIGHT_API_LLM_MODEL=openai/gpt-oss-20b

# Production-style embeddings/reranking via TEI
export HINDSIGHT_API_EMBEDDINGS_PROVIDER=tei
export HINDSIGHT_API_EMBEDDINGS_TEI_URL=http://127.0.0.1:8080
export HINDSIGHT_API_RERANKER_PROVIDER=tei
export HINDSIGHT_API_RERANKER_TEI_URL=http://127.0.0.1:8081
```

Doc rationale:

- Performance doc states retain is LLM-bottlenecked; recommends high-throughput providers and notes you don’t need a “smart model”.
  - Source: `developer/performance.md` → “Retain Performance”.

---

## 5) Knobs pi-ghosty should expose/tune (based on docs)

1) **Recall query shaping** to avoid HTTP 400 from `HINDSIGHT_API_RECALL_MAX_QUERY_TOKENS` (default 500).
   - Source: `developer/configuration.md` → “Retrieval”.

2) **Retain timestamps**: provide a session start timestamp so temporal ranking works.
   - Source: `best-practices.md` → “The `timestamp` Field”.

3) **Tags match mode**: allow strict modes (`any_strict`/`all_strict`) when bank is shared.
   - Source: `best-practices.md` → “Tag Filtering Modes”.

4) **Observations mission + scope policy**: expose knobs to tune observation synthesis and cap observation growth.
   - Source: `developer/configuration.md` → “Observations (Experimental)”.

5) **Retain extraction mode** (`concise` vs `chunks` vs `verbatim`) and chunk size for transcript ingestion.
   - Source: `developer/configuration.md` → “Retain”.

---

## 6) Anti-patterns (docs) that map directly to pi-ghosty

From `best-practices.md` → “Anti-patterns”:

- Do not pre-summarize before retain.
- Do not use random `document_id`.
- Do not omit `context`.
- Do not use `metadata` for filtering.
- Do not retain and recall in the same request.

pi-ghosty currently avoids most of these; main risk areas are **timestamp omission** and **oversized recall queries**.
