# Hindsight × pi-ghosty: serving-mode recommendation report (frontier / local-only / hybrid)

This report synthesizes the two Hindsight research artifacts and reconciles them with the **current pi-ghosty implementation**. It provides **actionable configuration recommendations** for three serving scenarios.

Sources:
- **Upstream Hindsight docs (branch-local):** `docs/Hindsight/skills/hindsight-docs/references/**` (server/API semantics; `HINDSIGHT_API_*`)
- Current repo behavior + agentmux launcher notes: `docs/archive/reference/hindsight_current_implementation.md`
- Local embedded `pg0` deployment notes: `docs/archive/reference/hindsight_docs_local_pg0.md`
- Supporting decision doc: `docs/decisions/0002-memory-hindsight.md`
- Supporting config reference (large): `docs/archive/reference/hindsight_config_first.md`
- Current implementation: `src/extensions/memoryExtension.ts`, env defaults: `src/env.ts`, example env: `.env.example`, runtime defaults: `pi-agent.json`

---

## 0) What pi-ghosty does today (baseline you’re configuring)

pi-ghosty uses a memory extension wired into the agent lifecycle (`docs/archive/reference/hindsight_current_implementation.md`, `src/extensions/memoryExtension.ts`).

- **Recall** runs at `before_agent_start` and injects a bullet list into the **system prompt**.
  - Query: `event.prompt` (unbounded; entire prompt).
  - Options: `max_tokens: 2048`, `budget: "mid"`, `tags: [projectTag, agent:<name>]`, `tags_match: "all"`, `types: ["observation","world","experience"]`, `async: true` (passed as `as any`).
  - It injects up to **30** `facts[].text` lines. (`src/extensions/memoryExtension.ts`)

- **Retain** runs at `agent_end` and sends the full session transcript.
  - `document_id = <projectTag>/<agentName>/<sessionId>`
  - `tags = [projectTag, agent:<name>, session:<id>]`
  - `observation_scopes = custom: [[projectTag],[agent:<name>]]` to consolidate at durable scopes.
  - `async: true` (passed as `as any`). (`src/extensions/memoryExtension.ts`, aligns with the v1 decision in `docs/decisions/0002-memory-hindsight.md`)

- **Reflect** is not wired in pi-ghosty v1. (`docs/archive/reference/hindsight_current_implementation.md`, `docs/decisions/0002-memory-hindsight.md`)

Operationally: pi-ghosty expects **a running Hindsight HTTP endpoint** at `HINDSIGHT_BASE_URL` (default `http://localhost:8888` in `src/env.ts` and `.env.example`).

---

## 1) Cross-artifact reconciliation: important mismatches / contradictions

### 1.1 Tag matching: current code is stricter than the “local pg0 notes” recommend

- Current code uses `tags_match: "all"` for recall (`src/extensions/memoryExtension.ts`; also described in `docs/archive/reference/hindsight_current_implementation.md`).
- The local pg0 artifact recommends “strict matching” when multiple agents share a bank and explicitly calls out `any_strict` as a workaround for cross-agent contamination (`docs/archive/reference/hindsight_docs_local_pg0.md`, citing `docs/archive/reference/hindsight_config_first.md` for `any_strict`).

Interpretation:
- `all` is **very strict** (requires both project and agent tag). That’s good for isolation but can under-recall cross-agent project memory.
- Recommendation: keep `all` as the default for multi-peer isolation (see §4), but consider adding a **configurable** mode so you can safely widen recall when desired.

### 1.2 “Local pg0 notes” are Hindsight-server-centric; current implementation doc mentions agentmux

- `docs/archive/reference/hindsight_docs_local_pg0.md` focuses on **Hindsight API env vars** (DB, embeddings, reranker, missions, observation flags).
- `docs/archive/reference/hindsight_current_implementation.md` additionally documents **agentmux** behavior for launching Hindsight (mapping to `HINDSIGHT_API_*` env and using embedded `pg0` via `pg0.Pg0`).

Interpretation:
- For pi-ghosty itself, the only required knobs are `HINDSIGHT_BASE_URL` and `HINDSIGHT_BANK_ID` (`src/env.ts`, `.env.example`, `pi-agent.json`).
- The rest belongs to how you run Hindsight (agentmux/sidecar/systemd/docker/etc.).

### 1.3 “Async” options are untyped and may be a no-op depending on client version

Both recall and retain pass `{ async: true }` with an `as any` cast (`src/extensions/memoryExtension.ts`), which `docs/archive/reference/hindsight_current_implementation.md` flags as “best-effort.”

Interpretation:
- Treat `async` behavior as **not guaranteed** unless verified against the pinned `@vectorize-io/hindsight-client` version (`package.json` shows `^0.4.22`).
- Recommendation: prefer to tune server-side concurrency/timeouts for stability rather than assuming client-side async works perfectly.

---

## 2) Recommended configuration by serving scenario

Each scenario below lists:
1) **pi-ghosty client config** (what this repo reads)
2) **Hindsight API config** (how to run the server)
3) **Operational tuning** (concurrency, isolation, scaling)

### Scenario A — Frontier (hosted/served memory stack; multi-machine; shared availability)

Use when:
- You want shared memory across machines/users (or you’re deploying beyond one laptop).
- You can operate a managed Postgres and/or managed model providers.

#### A1) pi-ghosty client (required)

Set (per deployment):
```bash
HINDSIGHT_BASE_URL=https://<your-hindsight-host>
HINDSIGHT_BANK_ID=pi-ghosty-<env-or-user>
PROJECT_TAG=project:<your-project>
```

Notes:
- Bank ID defaults to `pi-ghosty` (`src/env.ts`, `.env.example`). In frontier mode, **don’t share a default bank across unrelated deployments**—use explicit naming.

#### A2) Hindsight API (recommended)

Key shifts vs local:
- Replace embedded DB (`pg0`) with real Postgres:
  - `HINDSIGHT_API_DATABASE_URL=postgresql://...`
- Keep vector extension consistent with your Postgres setup (e.g., `pgvector`). (`docs/archive/reference/hindsight_docs_local_pg0.md` cites the DB knobs via `docs/archive/reference/hindsight_config_first.md`)

LLM/extraction/reranking:
- Use a strong “structured output reliable” provider/model for retain/reflect as suggested in the decision doc (`docs/decisions/0002-memory-hindsight.md`).
- Embeddings/reranking can be provider-backed (cloud) for throughput.

#### A3) Operational tuning (frontier)

- Isolation:
  - Default safe stance: keep pi-ghosty recall tag matching strict (current `tags_match: "all"`). (`src/extensions/memoryExtension.ts`)
  - If you must enable cross-agent project recall, do it by narrowing banks (per project/user) rather than weakening tags.
- Observations:
  - Keep `HINDSIGHT_API_ENABLE_OBSERVATIONS=true` (default-on behavior described in `docs/archive/reference/hindsight_docs_local_pg0.md` and v1 decision `docs/decisions/0002-memory-hindsight.md`).
- Storage growth:
  - Consider `HINDSIGHT_API_ENABLE_OBSERVATION_HISTORY=false` to reduce storage overhead (`docs/archive/reference/hindsight_docs_local_pg0.md`).

---

### Scenario B — Local-only (single machine; Hindsight sidecar + embedded pg0)

Use when:
- You want the simplest setup with **no external dependencies**.

#### B1) pi-ghosty client (minimal)

This is already the repo baseline:
```bash
HINDSIGHT_BASE_URL=http://localhost:8888
HINDSIGHT_BANK_ID=pi-ghosty
PROJECT_TAG=project:pi-ghosty
```

Sources: `.env.example`, `src/env.ts`, `pi-agent.json`.

#### B2) Hindsight API (recommended baseline)

From the local pg0 artifact (`docs/archive/reference/hindsight_docs_local_pg0.md`, citing `docs/archive/reference/hindsight_config_first.md`), use:
```bash
# DB (embedded)
HINDSIGHT_API_DATABASE_URL=pg0
HINDSIGHT_API_VECTOR_EXTENSION=pgvector

# Embeddings + reranking (local CPU baseline)
HINDSIGHT_API_EMBEDDINGS_PROVIDER=local
HINDSIGHT_API_EMBEDDINGS_LOCAL_MODEL=BAAI/bge-small-en-v1.5
HINDSIGHT_API_RERANKER_PROVIDER=local
HINDSIGHT_API_RERANKER_LOCAL_MODEL=cross-encoder/ms-marco-MiniLM-L-6-v2

# Observations
HINDSIGHT_API_ENABLE_OBSERVATIONS=true
HINDSIGHT_API_ENABLE_OBSERVATION_HISTORY=false

# Quality control: steer extraction away from noise
HINDSIGHT_API_RETAIN_MISSION="Focus on technical decisions, architecture choices, and team member expertise. Deprioritize social or personal information."
```

#### B3) Operational tuning (local-only)

- If your machine is resource constrained, lower Hindsight recall/retain concurrency (the local pg0 artifact explicitly notes this; it cites `docs/archive/reference/hindsight_config_first.md` for the concurrency knobs).
- Keep pi-ghosty’s strict tag matching (`tags_match: "all"`) to avoid cross-agent leakage inside a single shared local bank. (`src/extensions/memoryExtension.ts`)

---

### Scenario C — Hybrid (local storage; remote/served embeddings and/or memory LLM)

Use when:
- You want **data locality** (local DB) but better throughput/quality for embeddings/reranking and/or retain/reflect.

#### C1) pi-ghosty client

Same as local-only (Hindsight still appears as a local HTTP endpoint to pi-ghosty), or point to a LAN endpoint:
```bash
HINDSIGHT_BASE_URL=http://localhost:8888
HINDSIGHT_BANK_ID=pi-ghosty
```

#### C2) Hindsight API

Keep embedded local DB:
```bash
HINDSIGHT_API_DATABASE_URL=pg0
HINDSIGHT_API_VECTOR_EXTENSION=pgvector
```

Shift “heavy” ML components to served providers:
- Embeddings provider to TEI (or another served embedding stack), as suggested as an upgrade path (`docs/archive/reference/hindsight_docs_local_pg0.md`).
- Optionally use a stronger remote LLM for retain/reflect (aligned with the v1 decision’s “option open to use a stronger model/provider”). (`docs/decisions/0002-memory-hindsight.md`)

#### C3) Operational tuning (hybrid)

- Network dependency risks: plan for partial failures.
  - pi-ghosty already treats memory as optional (recall/retain errors are caught; described in `docs/archive/reference/hindsight_current_implementation.md` and visible in `src/extensions/memoryExtension.ts`).
- Keep strict tag scoping unless you have per-agent/per-project banks.

---

## 3) Concrete recommendations (do these now)

### 3.1 Recommended defaults (good across all scenarios)

1) **Set unique scoping values**
   - Keep `PROJECT_TAG` unique per repo/project (`src/env.ts`, `.env.example`).
   - For anything beyond a single local instance, use a non-default `HINDSIGHT_BANK_ID` naming scheme.

2) **Enable observations; disable observation history unless you need it**
   - Enable: `HINDSIGHT_API_ENABLE_OBSERVATIONS=true` (default-on learning loop; `docs/decisions/0002-memory-hindsight.md`, `docs/archive/reference/hindsight_docs_local_pg0.md`).
   - Consider: `HINDSIGHT_API_ENABLE_OBSERVATION_HISTORY=false` for storage control (`docs/archive/reference/hindsight_docs_local_pg0.md`).

3) **Use a retain mission** to prevent noisy memories
   - Recommended mission string is already proposed in `docs/archive/reference/hindsight_docs_local_pg0.md` (citing `docs/archive/reference/hindsight_config_first.md`).

### 3.2 If you operate multiple peers/agents in one bank

- Keep recall isolation strict.
  - Current code: `tags: [projectTag, agent:<name>]` + `tags_match: "all"` (`src/extensions/memoryExtension.ts`).
- If you later want “project-wide recall” (across agents), do it safely by:
  - moving to per-agent banks, or
  - adding a second recall pass (project-only) that is explicitly gated and clearly labeled in the prompt.

### 3.3 Performance tuning you can do without changing pi-ghosty code

- Lower server concurrency for local machines (the local pg0 artifact recommends reducing concurrency to reduce CPU/DB contention; it cites `docs/archive/reference/hindsight_config_first.md`).
- Keep recall payload bounded; pi-ghosty already uses `max_tokens: 2048`. (`src/extensions/memoryExtension.ts`)

---

## 4) Risks / gaps that matter for configuration decisions

1) **Recall query is the full prompt**
   - pi-ghosty passes `event.prompt` as the recall query (`src/extensions/memoryExtension.ts`; also described in `docs/archive/reference/hindsight_current_implementation.md`).
   - Risk: unnecessary token load + worse retrieval relevance.
   - Config implication: on frontier/hybrid, you may need to budget more for recall latency or tighten server-side limits.

2) **Async flag is untyped and may not work as intended**
   - Both recall and retain use `async: true` with `as any` (`src/extensions/memoryExtension.ts`; noted in `docs/archive/reference/hindsight_current_implementation.md`).
   - Risk: “non-blocking” expectations may be wrong; treat as best-effort.

3) **Bank collisions when sharing one Hindsight instance**
   - Default bank is `pi-ghosty` (`src/env.ts`, `.env.example`).
   - Risk: cross-project memory mixing.
   - Mitigation: enforce bank naming conventions and unique project tags.

4) **Reflect is not in the loop**
   - pi-ghosty v1 relies on observations as the “always-on learning loop” (`docs/decisions/0002-memory-hindsight.md`) and explicitly does not wire reflect yet (`docs/archive/reference/hindsight_current_implementation.md`).
   - Config implication: ensure observations are enabled if you expect durable synthesis without reflect.

---

## 5) Copy/paste config blocks

### 5.1 Local-only (recommended)

pi-ghosty (`.env`):
```bash
PROJECT_TAG=project:pi-ghosty
HINDSIGHT_BASE_URL=http://localhost:8888
HINDSIGHT_BANK_ID=pi-ghosty
GHOSTY_DISABLE_MEMORY=0
```

Hindsight API:
```bash
HINDSIGHT_API_DATABASE_URL=pg0
HINDSIGHT_API_VECTOR_EXTENSION=pgvector
HINDSIGHT_API_ENABLE_OBSERVATIONS=true
HINDSIGHT_API_ENABLE_OBSERVATION_HISTORY=false
HINDSIGHT_API_EMBEDDINGS_PROVIDER=local
HINDSIGHT_API_EMBEDDINGS_LOCAL_MODEL=BAAI/bge-small-en-v1.5
HINDSIGHT_API_RERANKER_PROVIDER=local
HINDSIGHT_API_RERANKER_LOCAL_MODEL=cross-encoder/ms-marco-MiniLM-L-6-v2
HINDSIGHT_API_RETAIN_MISSION="Focus on technical decisions, architecture choices, and team member expertise. Deprioritize social or personal information."
```

### 5.2 Hybrid (local DB; served embeddings/LLM)

Hindsight API (illustrative):
```bash
HINDSIGHT_API_DATABASE_URL=pg0
HINDSIGHT_API_VECTOR_EXTENSION=pgvector

# switch embeddings/reranking to served stacks
HINDSIGHT_API_EMBEDDINGS_PROVIDER=tei
# ... TEI endpoint vars per hindsight docs

# optionally stronger LLM provider for retain/reflect
HINDSIGHT_API_LLM_PROVIDER=openai
HINDSIGHT_API_LLM_BASE_URL=https://<provider-or-proxy>/v1
HINDSIGHT_API_LLM_MODEL=<memory-optimized-model>
```

### 5.3 Frontier (remote DB; managed scaling)

Hindsight API:
```bash
HINDSIGHT_API_DATABASE_URL=postgresql://<user>:<pass>@<host>:5432/<db>
HINDSIGHT_API_VECTOR_EXTENSION=pgvector
HINDSIGHT_API_ENABLE_OBSERVATIONS=true
HINDSIGHT_API_ENABLE_OBSERVATION_HISTORY=false
```

pi-ghosty:
```bash
HINDSIGHT_BASE_URL=https://<your-hindsight-host>
HINDSIGHT_BANK_ID=pi-ghosty-prod
PROJECT_TAG=project:<your-project>
```
