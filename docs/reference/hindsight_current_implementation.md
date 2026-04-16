# Hindsight: current implementation (pi-ghosty frontend + agentmux backend)

This note is **grounded in current repo code** and captures what actually happens today when pi-ghosty uses Hindsight for long-term memory, plus how the related `agentmux` repo launches/configures the Hindsight backend (notably the embedded local `pg0` Postgres).

## 1) pi-ghosty: where Hindsight is wired in

### 1.1 Extension wiring / lifecycle hooks

Memory is implemented as a Pi extension and is included in every agent session unless disabled via env.

- Memory extension is appended during session creation:
  - `src/pi/createSession.ts:151` adds `memoryExtensionFactory(...)` unless `env.GHOSTY_DISABLE_MEMORY` is true.
    - See also `src/env.ts:28` for `GHOSTY_DISABLE_MEMORY` defaulting to `false`.

### 1.2 Hindsight client wrapper

- `src/memory/hindsight.ts:1-10`
  - `createHindsightClient({ baseUrl, bankId })` constructs `new HindsightClient({ baseUrl })`.
  - **Note:** `bankId` is part of the config interface but is **not** passed into the client constructor (bankId is supplied per-call instead).

## 2) pi-ghosty: actual recall/retain behavior

All current behavior is in `src/extensions/memoryExtension.ts`.

### 2.1 Recall (injected into system prompt)

Recall runs at `before_agent_start` and attempts to inject memory into the *system prompt*.

- Recall call:
  - `src/extensions/memoryExtension.ts:66-79` calls:
    - `hindsight.recall(bankId, query, { ... })`
    - `query` is `event.prompt` (the prompt about to be sent), not a curated/short query.

- Recall parameters used:
  - `max_tokens: 2048` (`src/extensions/memoryExtension.ts:67`)
  - `budget: "mid"` (`:68`)
  - `tags: [projectTag, `agent:${agentName}`]` (`:69-72`)
  - `tags_match: "all"` (`:72`)
  - `types: ["observation", "world", "experience"]` (`:73`)
  - `async: true` (`:74`) — passed with an `as any` cast.

- What gets injected:
  - It extracts facts from `(recalled as any).facts ?? (recalled as any).results ?? []` (`src/extensions/memoryExtension.ts:81`).
  - It injects up to 30 `- ${f.text}` lines (`:82-89`) into the system prompt as:
    - `# Recalled Memory (<agentName>)` (`:111-112`).

- Failure behavior:
  - Exceptions are caught; memory injection is skipped (`return undefined`) and an error trace is written (`src/extensions/memoryExtension.ts:113-121`).
  - This means **memory is optional at runtime**: if Hindsight is down/unreachable, the agent continues without recall injection.

- Tracing:
  - JSONL tracing of recall timing, counts, etc. is written via `JsonlTrace.forAgent(...)` (`src/extensions/memoryExtension.ts:58-60`) and `trace.append({ type: "memory_recall", ... })` (`:93-106`).

### 2.2 Retain (session transcript at agent_end)

Retain runs at `agent_end` and sends a transcript of the session.

- Transcript construction:
  - `messagesToTranscript()` converts `AgentMessage[]` to a plain text transcript with `User: ...`, `Assistant: ...`, `ToolResult(...)` lines (`src/extensions/memoryExtension.ts:9-36`).

- Retain call:
  - `src/extensions/memoryExtension.ts:125-139` calls:
    - `hindsight.retain(bankId, transcript, { ... })`

- Retain parameters used:
  - `document_id: ${projectTag}/${agentName}/${sessionId}` (`src/extensions/memoryExtension.ts:123-128`)
  - `context: "pi-ghosty agent session transcript"` (`:129`)
  - `tags: [projectTag, agent:<name>, session:<id>]` (computed at `:55-57`; applied at `:130`)
  - `observation_scopes` is explicitly set to **custom** scopes:
    - `scopes: [[projectTag], [agent:<agentName>]]` (`src/extensions/memoryExtension.ts:132-136`)
    - Comment: “consolidate at durable scopes (project and agent), not per-session by default.” (`:131`)
  - `async: true` (`:137`) — passed with an `as any` cast.

- Failure behavior:
  - Retain errors are caught; the agent still ends normally and error + latency traces are appended (`src/extensions/memoryExtension.ts:159-186`).

- Reflect:
  - Not wired currently (“Reflect is not wired into pi-ghosty v1 yet.”) (`src/extensions/memoryExtension.ts:188-190`).

## 3) pi-ghosty: configuration knobs that affect runtime behavior

### 3.1 Frontend (pi-ghosty) env vars

Defined in `src/env.ts`:

- `HINDSIGHT_BASE_URL` default `http://localhost:8888` (`src/env.ts:22`)
- `HINDSIGHT_BANK_ID` default `pi-ghosty` (`src/env.ts:23`)
- `PROJECT_TAG` default `project:pi-ghosty` (`src/env.ts:19`)
- `GHOSTY_DISABLE_MEMORY` default `false` (`src/env.ts:28`)

These are used by `src/extensions/memoryExtension.ts:46-53` to compute `baseUrl`, `bankId`, and `projectTag`.

### 3.2 Frontend config file defaults

Runtime defaults include Hindsight location + bank:

- `src/config/schema.ts:16-27` includes `runtimeDefaultsSchema` with:
  - `hindsightBaseUrl: z.string().url()`
  - `hindsightBankId: z.string().min(1)`

- `src/config/loadConfig.ts:48-56` normalizes legacy shorthand `defaults.hindsightBaseUrl/hindsightBankId` into `defaults.runtime`.

**Important:** `memoryExtensionFactory` currently accesses `config.defaults.runtime!` with a non-null assertion (`src/extensions/memoryExtension.ts:47-53`). If the loaded config omits runtime defaults, this will crash at runtime.

## 4) agentmux: how the Hindsight backend is launched/configured (embedded pg0)

`pi-ghosty` itself does **not** launch Hindsight; it expects a running HTTP endpoint. The `agentmux` repo provides a local stack runner that can launch a Hindsight process and its embedded DB.

### 4.1 Hindsight as a normal service (engine = "hindsight")

- `agentmux/mux/examples/example_hindsight_memory.toml:26-34` shows the supported manifest shape:
  - `[services.memory] engine = "hindsight"`
  - `host`, `port`, `data_dir` and `llm_service = "main"`.

- Validation/parsing:
  - `agentmux/src/agentmux/config.py:275-324` parses engine=`hindsight` services.
  - Only allows keys `{engine,host,port,data_dir,llm_service,env,notes}` and errors on unknown fields (`config.py:283-294`).

### 4.2 Derived env for Hindsight process

When the runner plans a Hindsight service:

- `agentmux/src/agentmux/runner.py:230-252` derives env:
  - `HINDSIGHT_BIND_HOST`, `HINDSIGHT_BIND_PORT`, `HINDSIGHT_DATA_DIR`
  - `HINDSIGHT_LLM_PROVIDER` is hard-coded to `openai`
  - `HINDSIGHT_LLM_MODEL` is the referenced vLLM service’s `served_model_name` (or model path) (`runner.py:238-241, 247-250`)
  - `HINDSIGHT_LLM_API_KEY` defaults to `dummy` if not set (`runner.py:249`)
  - `HINDSIGHT_LLM_BASE_URL` is computed as the referenced vLLM service base URL + `/v1` (`runner.py:241-250`).

These env vars are consumed by the Hindsight launch script.

### 4.3 Embedded local Postgres via pg0 + Hindsight API env mapping

- `agentmux/scripts/hindsight_dev.py:31-47` starts embedded Postgres using `pg0.Pg0` with `data_dir` persistence.
- It maps runner env vars into Hindsight server env vars:
  - `HINDSIGHT_BIND_HOST` -> `HINDSIGHT_API_HOST` (`scripts/hindsight_dev.py:20`)
  - `HINDSIGHT_BIND_PORT` -> `HINDSIGHT_API_PORT` (`:21`)
  - `HINDSIGHT_LLM_PROVIDER/MODEL/API_KEY/BASE_URL` -> corresponding `HINDSIGHT_API_LLM_*` (`:22-25`)
  - It injects the embedded DB URI:
    - `HINDSIGHT_API_DATABASE_URL` and `HINDSIGHT_API_MIGRATION_DATABASE_URL` (`:26-27`).

- Then it launches the server:
  - `uv run hindsight-api --host <host> --port <port> --no-access-log` (`scripts/hindsight_dev.py:63-65`).

This is the key “embedded local pg0 setup”: the backend owns DB lifecycle and persistence, while frontends (pi-ghosty) just call HTTP.

### 4.4 Reuse/external detection

- `agentmux/src/agentmux/runner.py:252-287`:
  - If the requested Hindsight port is already in use, the runner probes `GET /health` or `/` (`runner.py:218-227`).
  - If healthy, it marks the service as `managed=False` and uses an `external-hindsight` placeholder command.
  - If the port is used but not healthy, it errors.

## 5) Gaps / mismatches / recommendations (actionable)

### 5.1 pi-ghosty config fragility

- `memoryExtensionFactory` assumes `config.defaults.runtime` is present (`src/extensions/memoryExtension.ts:47-53`).
  - Recommendation: either make runtime defaults required in config schema or add a safer fallback to `env` defaults (`src/env.ts:22-23`) without non-null assertions.

### 5.2 “async: true” is currently best-effort

- Both recall and retain pass `async: true` with `as any` (`src/extensions/memoryExtension.ts:74, 137`).
  - Recommendation: confirm upstream `@vectorize-io/hindsight-client` supports this option in the current pinned version and (if so) type it properly to avoid silent no-ops.

### 5.3 Query construction is unbounded/expensive

- Recall uses `event.prompt` directly (`src/extensions/memoryExtension.ts:64-66`).
  - Recommendation: build a short recall query (e.g., last user message + current task) to reduce token load on the backend and improve retrieval relevance.

### 5.4 Bank/project scoping is minimal and may collide across repos

- `HINDSIGHT_BANK_ID` defaults to `pi-ghosty` (`src/env.ts:23`).
  - If multiple apps share the same local Hindsight instance, they should use distinct banks.
  - Recommendation: document bank naming conventions and enforce `PROJECT_TAG` uniqueness.

### 5.5 Reflect not integrated

- Reflect is explicitly not wired (`src/extensions/memoryExtension.ts:188-190`).
  - Recommendation: decide whether reflect/consolidation is exclusively a Hindsight backend concern (observations enabled) or if pi-ghosty should add an explicit reflect step (manual/scheduled) and how to gate it.

---

## Appendix: quick pointers

- pi-ghosty frontend entry points:
  - `src/pi/createSession.ts` (extension wiring)
  - `src/extensions/memoryExtension.ts` (retain/recall)

- agentmux backend entry points:
  - `src/agentmux/runner.py` (`engine="hindsight"` planning + env derivation + reuse checks)
  - `scripts/hindsight_dev.py` (embedded pg0 + `hindsight-api` launch)
  - `mux/examples/example_hindsight_memory.toml` (manifest shape)
