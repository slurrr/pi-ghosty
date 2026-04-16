# Hindsight (docs-only) best practices for adopting with embedded local pg0

This reference is **implementation-agnostic** and is derived from the **actual Hindsight documentation** shipped in this repo under `docs/Hindsight/skills/hindsight-docs/references/**`.

It is written for a repo that wants to adopt Hindsight from scratch, using **embedded local pg0** initially, while keeping a clear path to **local-only**, **hybrid**, and **frontier** deployments.

## Branch-local upstream docs note (source of truth)

On this branch, the upstream Hindsight docs live locally under:

- `docs/Hindsight/skills/hindsight-docs/references/**`

These files are the **source of truth for Hindsight server behavior** (API semantics, env vars prefixed `HINDSIGHT_API_*`, storage/pg0, embeddings, reranking, and performance tuning). If you are reading this doc in a checkout where `docs/Hindsight/skills` is missing, treat server semantics as external/upstream and do not assume these paths exist.

## Sources (primary)

- Best practices: `docs/Hindsight/skills/hindsight-docs/references/best-practices.md`
- Configuration (env vars): `docs/Hindsight/skills/hindsight-docs/references/developer/configuration.md`
- Storage/pg0: `docs/Hindsight/skills/hindsight-docs/references/developer/storage.md`
- Retrieval architecture: `docs/Hindsight/skills/hindsight-docs/references/developer/retrieval.md`
- Retain architecture: `docs/Hindsight/skills/hindsight-docs/references/developer/retain.md`
- Reflect architecture: `docs/Hindsight/skills/hindsight-docs/references/developer/reflect.md`
- API references (bank config, retain, recall, operations):
  - `docs/Hindsight/skills/hindsight-docs/references/developer/api/memory-banks.md`
  - `docs/Hindsight/skills/hindsight-docs/references/developer/api/retain.md`
  - `docs/Hindsight/skills/hindsight-docs/references/developer/api/recall.md`
  - `docs/Hindsight/skills/hindsight-docs/references/developer/api/operations.md`

Line-number citations are included where the repo tools can reliably extract them (via `grep`).

---

## 1) Adopt Hindsight using the right mental model

Hindsight’s taxonomy is explicit:

- **Retain** ingests raw content and extracts facts/entities/relationships; “raw content is never stored verbatim” (best practices doc).
- **Recall** retrieves ranked facts using 4 parallel strategies: semantic, BM25 keyword, graph traversal, and temporal ranking (best practices + retrieval architecture).
- **Observations** are consolidated patterns produced asynchronously after retain (best practices + observations docs).
- **Reflect** is an agentic loop that answers questions, not just retrieves facts (reflect docs).

This matters because your integration choices should match the operation:

- Use **retain** to update memory
- Use **recall** to inject supporting facts into your agent
- Use **reflect** only when you want Hindsight to produce an answer directly

---

## 2) Banks, isolation, and safety defaults

### 2.1 Banks are the unit of isolation

Hindsight treats a **bank** as an isolated memory store; banks do not share data (best practices → “Memory Banks”; API → `memory-banks.md`).

**Docs-led recommendation:** choose bank IDs as your *primary* isolation boundary.

Common patterns in the docs:

- one bank per user (multi-user apps)
- one bank per agent
- shared bank + strict tags (allowed, but requires care)

### 2.2 Tags are the filter primitive (not metadata)

- Tags scope visibility and are intended for filtering.
- Metadata is explicitly “not filterable” (best practices → “Metadata Schema”).

**Docs-led recommendation:** if you need to filter on something at recall/reflect time, make it a **tag**.

### 2.3 Tag naming conventions

Hindsight recommends consistent tag prefixes (best practices → “Tags: Naming Conventions”; location: `best-practices.md:248`).

Common patterns:

- `user:<id>`
- `session:<id>`
- `team:<name>`
- `topic:<name>`
- `scope:<name>`

### 2.4 Strict tag matching for multi-tenant safety

The best practices doc calls out `tags_match="any"` as an anti-pattern for multi-tenant banks, recommending `any_strict` or `all_strict` to avoid leakage (`best-practices.md:353-355`, `best-practices.md:567`).

**Docs-led recommendation (default):**

- If banks are shared across principals, default to strict modes (`any_strict`/`all_strict`).
- If you intentionally want “global untagged” facts plus user facts, use non-strict modes carefully.

---

## 3) pg0-based deployment: what the docs recommend

### 3.1 pg0 is for development; production uses Postgres

Configuration doc:

- `HINDSIGHT_API_DATABASE_URL` default is `pg0` (embedded) (`developer/configuration.md:22`).
- “embedded `pg0` — convenient for development but not recommended for production.” (`developer/configuration.md:27`).

Storage doc:

- pg0 stores data in `~/.hindsight/pg0/` and starts embedded Postgres when no DB URL is configured (storage → “Development with pg0”; see `storage.md:41-63`).

**Docs-led recommendation:**

- Start with `pg0` for local dev.
- Plan an upgrade path to Postgres 15+ for production.

### 3.2 DB-related env knobs worth exposing

From `developer/configuration.md` (Database section):

- `HINDSIGHT_API_DATABASE_URL` (default `pg0`) (`developer/configuration.md:22`)
- `HINDSIGHT_API_MIGRATION_DATABASE_URL` (for migrations bypassing poolers)
- `HINDSIGHT_API_DATABASE_SCHEMA` (default `public`)
- `HINDSIGHT_API_RUN_MIGRATIONS_ON_STARTUP` (default `true`)

From connection pooling:

- `HINDSIGHT_API_DB_POOL_MIN_SIZE`, `...MAX_SIZE`, timeouts

### 3.3 Vector/text search backends (scale knobs)

The config doc supports:

- `HINDSIGHT_API_VECTOR_EXTENSION` (`pgvector` / `pgvectorscale` / `vchord`)
- `HINDSIGHT_API_TEXT_SEARCH_EXTENSION` (`native` / `vchord` / `pg_textsearch`)

**Docs-led recommendation:**

- Start with defaults (`pgvector` + `native`).
- For large datasets, consider DiskANN (`pgvectorscale`) per docs (configuration → Vector Extension).

---

## 4) Retain: ingestion best practices

### 4.1 Don’t pre-summarize

Best practices explicitly say to avoid pre-summarization (anti-pattern table in `best-practices.md`).

**Why (docs):** pre-summarization loses entity relationships, temporal markers, and structure.

### 4.2 Always send the richest available structure

Best practices recommend:

- For conversations, use a structured JSON conversation array when possible (best practices → “Content Format”).
- Prefixed plain text is acceptable.

### 4.3 Always set `context`

The best practices doc calls the `context` field “high-impact on extraction quality” and says “Always set it” (best practices → “The `context` Field”).

### 4.4 Use stable `document_id` for idempotence/upserts

Best practices:

- Stable IDs enable upsert.
- Don’t use random UUIDs per retain call.

API retain doc reinforces idempotence semantics (retain API → “document_id” and “update_mode”).

### 4.5 Use timestamps

Retain API:

- `timestamp` controls the event time; omitted defaults to current time; special value `"unset"` stores content with no timestamp (for timeless content).
  - Source: `developer/api/retain.md` → “timestamp”.

Best practices:

- Missing timestamps disable temporal ranking entirely (best practices → “The `timestamp` Field”).

### 4.6 Use `update_mode` for growing content (append)

Retain API explicitly supports `update_mode` with default `replace` and optional `append` for incremental growth (retain API: `developer/api/retain.md:188+` includes `update_mode`).

**Docs-led recommendation:**

- Use `replace` for fully-resubmitted canonical docs.
- Use `append` for logs/journals/chats where you stream new content; the docs note delta retain skips unchanged chunks.

### 4.7 Extraction mode + chunking (server knobs)

Configuration doc:

- `HINDSIGHT_API_RETAIN_CHUNK_SIZE` default 3000 characters.
- `HINDSIGHT_API_RETAIN_EXTRACTION_MODE` supports `concise`, `verbose`, `verbatim`, `chunks`, `custom` (`developer/configuration.md:696-719`).

Docs-led interpretation:

- Start with `concise`.
- Use `verbose` when you need richer facts.
- Use `verbatim` if you want original chunk text stored as the “memory unit” (LLM still extracts indexing metadata).
- Use `chunks` for **zero LLM cost** ingestion (but you lose entity/temporal indexing unless you provide entities manually).
- Use `custom` only if you truly need to replace the extraction rules.

### 4.8 Missions (retain mission)

Configuration doc:

- `HINDSIGHT_API_RETAIN_MISSION` steers extraction without replacing built-in rules (retain section).

Bank-level config doc:

- Bank config supports `retain_mission` and `retain_extraction_mode` (see `developer/api/memory-banks.md` → `retain_mission` / `retain_extraction_mode`).

**Docs-led recommendation:** start by setting a clear `retain_mission` before you reach for custom instructions.

### 4.9 Async retain + operations

- Best practices: use async for end-of-turn/end-of-session where latency matters; and avoid retain+recall in same turn.
- Operations API: async retains return an `operation_id` you can poll (`developer/api/operations.md`).

**Cost knob:** `HINDSIGHT_API_RETAIN_BATCH_ENABLED` can use an LLM Batch API for 50% cost savings and works only with async operations (`developer/configuration.md:700`; performance doc reiterates this).

---

## 5) Observations: consolidation controls

Configuration knobs (observations section):

- `HINDSIGHT_API_ENABLE_OBSERVATIONS` default `true` (`developer/configuration.md:971`).
- `HINDSIGHT_API_OBSERVATIONS_MISSION` to redefine what gets synthesized (observations section).
- audit/storage knobs: observation history, max observations per scope.

Best practices + observations docs:

- Observations represent durable synthesized patterns.
- Observations are included in recall/reflect and can be filtered via `types`.
- `observation_scopes` controls which tag combinations get separate observation passes.

**Docs-led recommendation:**

- Keep observations enabled unless you have a clear reason.
- If you use tags heavily (multi-scope memories), define observation scopes explicitly.
- Set an observations mission if “default durable-knowledge” is not aligned with your domain.

---

## 6) Recall: retrieval knobs and safe defaults

### 6.1 Budget + max_tokens

The recall API supports:

- `budget` = `low|mid|high`
- `max_tokens` = token budget for returned fact text

The best practices doc provides latency guidance and recommends `mid` as default and `low` for high-frequency loops.

### 6.2 Keep recall queries small (hard server limit)

The configuration doc includes:

- `HINDSIGHT_API_RECALL_MAX_QUERY_TOKENS` default 500; exceeding this is rejected with HTTP 400 (`developer/configuration.md:679`).

The recall API doc also states: “Queries exceeding 500 tokens are rejected.” (see `developer/api/recall.md` → “query”).

**Docs-led recommendation:** implement query shaping in your app (e.g., short task summary + last user request), rather than sending full prompts.

### 6.3 Use `query_timestamp` for time-anchored recall

Recall API supports `query_timestamp` to anchor relative temporal expressions in the query (see `developer/api/recall.md` → “query_timestamp”).

**Docs-led recommendation:** use `query_timestamp` when replaying historical conversations or when “now” should be anchored to a different time.

### 6.4 Include options

Recall API supports include options such as:

- `include.chunks` (raw source chunks) with independent token budget
- `include.source_facts` to show provenance for observations

Docs recommend enabling these only when needed (auditing/debugging/quoting).

---

## 7) Reflect: when to use it and how to configure it

Reflect is an agentic loop (reflect docs) and should be used when you want Hindsight to answer a question, not just retrieve facts.

Key configuration knobs (configuration doc → Reflect section):

- iteration and context limits: `HINDSIGHT_API_REFLECT_MAX_ITERATIONS`, `...MAX_CONTEXT_TOKENS`, wall timeout.
- missions: `HINDSIGHT_API_REFLECT_MISSION` (global) and per-bank `reflect_mission`.
- dispositions: `HINDSIGHT_API_DISPOSITION_SKEPTICISM`, `...LITERALISM`, `...EMPATHY`.

Docs-led recommendation:

- Treat reflect as optional: it’s slower than recall and uses LLM generation.
- Use missions + dispositions to create consistent behavior.
- Use directives for hard rules (reflect docs: “Directives: Hard Rules”; bank API supports directives).

---

## 8) Entity labels: when ranking isn’t enough

The docs strongly recommend controlled **entity labels** when a bank contains semantically similar memories of different shapes.

- Entity labels are configured per-bank (`developer/api/memory-banks.md` → `entity_labels`).
- Setting `tag: true` on a label group writes labels as tags, enabling hard filtering at SQL level.

Docs-led recommendation:

- Create 1–3 label groups that matter for your app (e.g., `memory_type:rule|procedure`, `priority:high|low`).
- Use tag-backed labels for “hard separation” of memory shapes.

---

## 9) Embeddings and reranking: local vs hybrid vs frontier

### 9.1 Embeddings

Configuration doc:

- `HINDSIGHT_API_EMBEDDINGS_PROVIDER` defaults to `local` (`developer/configuration.md:396`).
- `HINDSIGHT_API_EMBEDDINGS_LOCAL_TRUST_REMOTE_CODE` is a security risk and defaults to `false` (`developer/configuration.md:398`).

Docs-led recommendation:

- Start local for pg0-based dev.
- Avoid enabling `trust_remote_code` unless you trust the model source.
- For production, docs call out TEI as “recommended for production” (embeddings section examples).

### 9.2 Reranker

Configuration doc:

- `HINDSIGHT_API_RERANKER_PROVIDER` defaults to `local` (`developer/configuration.md:523`).
- Performance knobs exist for the local reranker (max concurrent, batch sizing, and bucket batching) including:
  - `HINDSIGHT_API_RERANKER_LOCAL_BUCKET_BATCHING` (faster, quality-identical) (`developer/configuration.md:529`).

Docs-led recommendation:

- Start with local reranker.
- For performance, enable bucket batching after validation.
- For hybrid/frontier, consider TEI or hosted rerankers.

### 9.3 Local-only vs hybrid vs frontier (docs-led tradeoffs)

**Local-only (pg0 + local emb + local rerank + local LLM endpoint)**

- Pros: privacy, simplicity, minimal external dependencies.
- Cons: CPU contention (reranker), slower retain depending on local LLM.

**Hybrid (pg0/Postgres + TEI embeddings/rerank + hosted retain LLM)**

- Pros: faster and more scalable retrieval/ingestion.
- Cons: more infra; network dependencies.

**Frontier (hosted best models for retain/reflect)**

- Pros: highest quality extraction and reflect.
- Cons: cost and latency.

The performance doc explicitly says “Hindsight doesn’t need a smart model” for retain and recommends high-throughput providers (performance → Retain Performance).

---

## 10) Recommended “starter” configurations (pg0-first)

### 10.1 Starter: local pg0 dev (minimal)

```bash
# Storage
export HINDSIGHT_API_DATABASE_URL=pg0

# Keep defaults for embeddings/reranker
# HINDSIGHT_API_EMBEDDINGS_PROVIDER=local  (default)
# HINDSIGHT_API_RERANKER_PROVIDER=local    (default)

# Keep observations enabled
export HINDSIGHT_API_ENABLE_OBSERVATIONS=true
```

### 10.2 Starter: safe multi-tenant tagging strategy (app-level)

- Always tag retained items with `user:<id>` (best practices → tags naming conventions).
- Use strict tags match when recalling:
  - `tags_match="any_strict"` or `all_strict` (best practices: `best-practices.md:353-355`, `best-practices.md:567`).

### 10.3 Starter: missions

- Set a `retain_mission` for your domain before custom extraction.
- Optionally set `observations_mission` to define “durable patterns” relevant to your app.
- Set `reflect_mission` + dispositions if you use reflect.

---

## 11) Anti-patterns (docs)

The best practices doc enumerates these as anti-patterns (see `best-practices.md` → “Anti-patterns”):

- Pre-summarizing before retain
- Random UUIDs as `document_id`
- Omitting `context`
- Using `metadata` for filtering
- `tags_match="any"` for multi-tenant banks (leakage)
- Retaining and recalling in the same request/turn
- Using `high` budget for every recall
- Missing timestamps on retain (disables temporal retrieval)

---

## 12) What config surfaces are worth exposing in a new repo

Based on the docs, the most leverage-per-knob settings to expose are:

1) Bank ID strategy (per user / per project) and tag naming policy.
2) Retain: `context`, `document_id`, `timestamp`, `update_mode`.
3) Recall: `budget`, `max_tokens`, `types`, `tags_match`, `query_timestamp`.
4) Missions: retain/observations/reflect.
5) Observations scopes and caps.
6) Embeddings provider and reranker provider.
7) DB URL + schema (and a clear “pg0 dev vs Postgres prod” switch).

If a knob is not needed by your use case, do not expose it; the docs emphasize starting simple and moving to more complex options (e.g., custom retain instructions) only when required.
