# Hindsight (pi-ghosty) — local embedded `pg0` deployment notes

This artifact distills the Hindsight settings that matter for a **local embedded PostgreSQL (`pg0`)** setup, with guidance for scaling to hybrid/frontier deployments.

> Primary references (in-repo):
> - `docs/reference/hindsight_config_first.md`
> - `docs/decisions/0002-memory-hindsight.md`

## What “local embedded pg0” means

Hindsight’s API can run with an embedded PostgreSQL via `pg0`.

- `HINDSIGHT_API_DATABASE_URL=pg0` (embedded Postgres by default) (`docs/reference/hindsight_config_first.md:118`)
- `HINDSIGHT_API_VECTOR_EXTENSION=pgvector` (vector index extension; alternatives listed) (`docs/reference/hindsight_config_first.md:119`)

This is the simplest “single-machine” deployment: **one Hindsight sidecar** (HTTP) + **local storage** + **local embedding/reranking models**.

## Minimal local pg0 configuration (recommended baseline)

pi-ghosty’s Hindsight integration expects:

```bash
# pi-ghosty -> Hindsight client
HINDSIGHT_BASE_URL=http://localhost:8888
HINDSIGHT_BANK_ID=pi-ghosty

# Hindsight API -> DB
HINDSIGHT_API_DATABASE_URL=pg0
HINDSIGHT_API_VECTOR_EXTENSION=pgvector

# Embeddings + reranking (local CPU baseline)
HINDSIGHT_API_EMBEDDINGS_PROVIDER=local
HINDSIGHT_API_EMBEDDINGS_LOCAL_MODEL=BAAI/bge-small-en-v1.5
HINDSIGHT_API_RERANKER_PROVIDER=local
HINDSIGHT_API_RERANKER_LOCAL_MODEL=cross-encoder/ms-marco-MiniLM-L-6-v2

# Observations (enabled by default)
HINDSIGHT_API_ENABLE_OBSERVATIONS=true
# Optional: reduce storage overhead
HINDSIGHT_API_ENABLE_OBSERVATION_HISTORY=false
```

Citations:
- DB defaults: `HINDSIGHT_API_DATABASE_URL`/`HINDSIGHT_API_VECTOR_EXTENSION` (`docs/reference/hindsight_config_first.md:118-119`)
- Embeddings defaults (`docs/reference/hindsight_config_first.md:323-325`, `:460-461`)
- Reranker defaults (`docs/reference/hindsight_config_first.md:331-333`, `:464`)
- Observations defaults (`docs/reference/hindsight_config_first.md:248`)
- Observation history storage note (`docs/reference/hindsight_config_first.md:371`, `:426`, `:457`)

## Bank configuration that matters locally (missions, scopes, leakage control)

### 1) Retain mission (controls what gets extracted)

Set a mission so fact extraction focuses on what you want to remember (technical decisions, constraints).

- Example mission (`docs/reference/hindsight_config_first.md:132`):

```bash
HINDSIGHT_API_RETAIN_MISSION="Focus on technical decisions, architecture choices, and team member expertise. Deprioritize social or personal information."
```

### 2) Observation scopes (controls *durable* learning consolidation)

pi-ghosty’s intended pattern is to consolidate observations at **project** and **agent** scopes (not per-session by default).

- Overview: observation scopes set to custom (`docs/reference/hindsight_config_first.md:52`, `:258-260`)

Example:
```json
{
  "observation_scopes": {
    "mode": "custom",
    "scopes": [
      ["project:pi-ghosty"],
      ["agent:coder"]
    ]
  }
}
```

### 3) Tags + strict matching (prevents cross-agent leakage in a single shared bank)

With **one bank** (v1 default), tag filtering is the isolation mechanism.

- `tags_match` options are shown in recall options (`docs/reference/hindsight_config_first.md:208`).
- Cross-agent contamination risk when using `tags_match: any` is called out (`docs/reference/hindsight_config_first.md:348`).
- Workaround: use `any_strict` (`docs/reference/hindsight_config_first.md:370`, `:435`).

Practical recommendation:
- Tag every retained document with at least: `project:<name>`, `agent:<name>`, `session:<id>` (design decision: `docs/decisions/0002-memory-hindsight.md` “Document ID + tags strategy” section).
- For recall injection, prefer strict matching (e.g., `any_strict`) when multiple agents/peers share a bank.

## Retain / recall / reflect / observations: local defaults + tradeoffs

### Retain (post-turn)

Key knobs:
- `HINDSIGHT_API_RETAIN_CHUNK_SIZE` default `3000` (`docs/reference/hindsight_config_first.md` retain table; see “Retain Settings” section)
- `HINDSIGHT_API_RETAIN_EXTRACTION_MODE=concise` default (`docs/reference/hindsight_config_first.md` extraction mode table)

Tradeoffs:
- `concise` is the long-term-memory default.
- `verbatim`/`chunks` reduce/avoid LLM extraction cost but rely more on embeddings recall (less structured durable facts) (`docs/reference/hindsight_config_first.md:139-143`, `:399-401`).

### Recall (pre-turn)

Operational knobs:
- `HINDSIGHT_API_RECALL_MAX_CONCURRENT` default `32` (`docs/reference/hindsight_config_first.md:196`)
- `HINDSIGHT_API_RECALL_CONNECTION_BUDGET` default `4` (`docs/reference/hindsight_config_first.md:197`)
- `HINDSIGHT_API_RERANKER_MAX_CANDIDATES` default `300` (`docs/reference/hindsight_config_first.md:198`)

Tradeoffs:
- For local-only machines, reducing concurrency can reduce CPU/DB contention (`docs/reference/hindsight_config_first.md:389-390`).
- Keep recall payload bounded (example `max_tokens: 2048` in client options) (`docs/reference/hindsight_config_first.md:204-210`).

### Reflect (deeper synthesis)

pi-ghosty currently notes reflect is **not wired into the agent flow** (`docs/reference/hindsight_config_first.md:340-343`).

Local setup implication:
- You can still run reflect manually or schedule it, but it’s not part of the default per-turn loop.

### Observations (background consolidation)

Observations are enabled by default (`docs/reference/hindsight_config_first.md:248`) and are described as the default “always-on learning loop” in the design decision (`docs/decisions/0002-memory-hindsight.md`, “Reflect / Consolidate”).

Local tradeoffs:
- Observation history can add storage overhead; disable history if disk is a concern (`docs/reference/hindsight_config_first.md:371`, `:426`, `:457`).

## Embedded local-only vs hybrid vs frontier: recommended deployment modes

### Mode A — **Local-only** (single machine, simplest)

Use when:
- You want zero external dependencies and acceptable CPU latency.

Recommended defaults:
- DB: `pg0` + `pgvector` (`docs/reference/hindsight_config_first.md:118-119`)
- Embeddings/reranker: local CPU models (`docs/reference/hindsight_config_first.md:323-325`, `:331-333`)
- Consider: lower concurrency caps for recall/retain if the machine is resource-constrained (`docs/reference/hindsight_config_first.md:389-390`, `:402-403`).

Known limitation:
- Local embeddings on CPU can be slow on large datasets; doc suggests TEI or cloud provider (`docs/reference/hindsight_config_first.md:372`).

### Mode B — **Hybrid** (local pg0 storage, remote/served embeddings)

Use when:
- You want to keep data local (pg0) but improve embedding throughput.

Change:
- Set embeddings provider to `tei` (or another provider) while keeping `HINDSIGHT_API_DATABASE_URL=pg0`.

Tradeoff:
- More moving parts (an embeddings service), but faster indexing/recall for larger banks.

### Mode C — **Frontier/served** (remote DB + remote model providers)

Use when:
- You need higher availability, multi-machine scaling, or shared memory across hosts.

Change:
- Replace `HINDSIGHT_API_DATABASE_URL=pg0` with a real Postgres connection string.
- Consider non-local embeddings/reranking providers.

Tradeoff:
- Operational complexity + network latency; consider strict tag scoping to avoid multi-tenant leakage.

## Practical “starting point” defaults for pi-ghosty

From the project decision:
- Run Hindsight as a **local sidecar** (`http://localhost:8888`) (`docs/decisions/0002-memory-hindsight.md`, “High-level design”).
- Start with **one bank** for v1 + tag scoping (`docs/decisions/0002-memory-hindsight.md`, “High-level design”).
- Use observation consolidation as default learning loop; reflect is explicit/scheduled (`docs/decisions/0002-memory-hindsight.md`, “Reflect / Consolidate”).
- Use local CPU-friendly embeddings/reranking initially (`docs/decisions/0002-memory-hindsight.md:62-65`).

## Quick checklist (local pg0)

- [ ] `HINDSIGHT_API_DATABASE_URL=pg0` set (or left default) (`docs/reference/hindsight_config_first.md:118`)
- [ ] `HINDSIGHT_API_VECTOR_EXTENSION=pgvector` (`docs/reference/hindsight_config_first.md:119`)
- [ ] Use a **retain mission** to reduce noise (`docs/reference/hindsight_config_first.md:132`)
- [ ] Configure **custom observation scopes** (project + agent) (`docs/reference/hindsight_config_first.md:52`, `:258-260`)
- [ ] Use strict tag matching for recall to prevent cross-agent leakage (`docs/reference/hindsight_config_first.md:370`, `:435`)
- [ ] If disk is tight, disable observation history (`docs/reference/hindsight_config_first.md:371`, `:426`)
- [ ] If recall/indexing is slow, migrate embeddings to TEI/provider (`docs/reference/hindsight_config_first.md:372`)
