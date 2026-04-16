# Hindsight best practices for pi-ghosty (local-only / hybrid / frontier)

This doc is grounded in **current pi-ghosty code/config**, not external launcher repos.

## Scope and source of truth

**Branch-local upstream docs:** this branch vendors upstream Hindsight documentation at `docs/Hindsight/skills/hindsight-docs/references/**`. Use that as the primary source of truth for **Hindsight server/API** behavior and `HINDSIGHT_API_*` env knobs.

This doc is scoped to **pi-ghosty as a Hindsight client**: it documents client-side settings and how pi-ghosty calls a running Hindsight HTTP API. It does not redefine server defaults.

- Memory behavior implementation: `src/extensions/memoryExtension.ts`
- Memory config schema: `src/config/schema.ts`
- Config normalization and file precedence: `src/config/loadConfig.ts`
- Mode config examples:
  - `pi-agent-canonical.json`
  - `pi-agent-local.json`
  - `pi-agent-frontier.json`

pi-ghosty itself is a **Hindsight client**. It reads client settings (`HINDSIGHT_BASE_URL`, `HINDSIGHT_BANK_ID`, memory config) and calls a running Hindsight HTTP API.

---

## 1) Effective config precedence (important)

### Runtime (`src/index.ts`, `src/tui/startTui.ts`)
`loadConfig()` resolves first existing file in this order:
1. `pi-agent-canonical.json`
2. `pi-agent-local.json`
3. `pi-agent-frontier.json`
4. `pi-agent.json` (legacy)

### Pi extension mode (`.pi/extensions/ghosty/index.ts`)
Extension mode requires:
- `GHOSTY_AGENT_CONFIG_PATH` (explicit path)

### Env overrides
At runtime, memory extension resolves:
- `HINDSIGHT_BASE_URL` over config runtime default
- `HINDSIGHT_BANK_ID` over config runtime default
- `PROJECT_TAG` over config default

So if behavior looks wrong, verify both file selection and env overrides.

---

## 2) Memory config surface (now configurable)

`defaults.memory` controls recall/retain in `memoryExtension`.

### Recall
`defaults.memory.recall`:
- `maxTokens` (default `2048`)
- `budget` (default `"mid"`)
- `tagsMatch` (default `"all"`)
- `types` (default `["observation", "world", "experience"]`)
- `maxFacts` (default `30`)
- `queryMaxChars` (optional, disabled when omitted)

### Retain
`defaults.memory.retain`:
- `context` (default `"pi-ghosty agent session transcript"`)
- `async` (default `true`)
- `observationScopes`:
  - `includeProjectScope` (default `true`)
  - `includeAgentScope` (default `true`)
  - `includeSessionScope` (default `false`)

### Default isolation stance
The safe default remains strict isolation:
- recall tags: `[projectTag, agent:<name>]`
- `tagsMatch: "all"`

---

## 3) Scenario guidance

## A) Local-only
Recommended:
- `HINDSIGHT_BASE_URL=http://127.0.0.1:8888`
- keep `tagsMatch: "all"`
- optionally set `queryMaxChars` (e.g. `2000-8000`) to bound recall query size on weaker machines

## B) Hybrid
Recommended:
- same pi-ghosty client settings as local-only
- keep strict tag matching
- set `queryMaxChars` to reduce long-prompt recall latency
- tune backend Hindsight API independently (provider/embedding/reranker settings are server-side, not read by pi-ghosty)

## C) Frontier
Recommended:
- use explicit bank IDs per environment/project/user (avoid shared default bank)
- keep `tagsMatch: "all"` unless intentionally broadening recall
- if broadening recall, prefer bank partitioning over weakening tag matching

---

## 4) Canonical config example (memory block)

```json
{
  "defaults": {
    "projectTag": "project:pi-ghosty",
    "memory": {
      "recall": {
        "maxTokens": 2048,
        "budget": "mid",
        "tagsMatch": "all",
        "types": ["observation", "world", "experience"],
        "maxFacts": 30,
        "queryMaxChars": 4000
      },
      "retain": {
        "context": "pi-ghosty agent session transcript",
        "async": true,
        "observationScopes": {
          "mode": "custom",
          "includeProjectScope": true,
          "includeAgentScope": true,
          "includeSessionScope": false
        }
      }
    }
  }
}
```

---

## 5) Current implementation caveats

- Reflect is not wired yet in pi-ghosty memory flow.
- Recall currently sends `async: true` as a fixed call option (best-effort client behavior).
- Retain async is configurable via `defaults.memory.retain.async`.
- If `defaults.runtime` is absent, memory extension falls back to `http://localhost:8888` and bank `pi-ghosty` unless env vars override.

---

## 6) Practical checklist

- Confirm which config file is actually loaded (precedence above, or `GHOSTY_AGENT_CONFIG_PATH` in extension mode).
- Confirm env overrides (`HINDSIGHT_BASE_URL`, `HINDSIGHT_BANK_ID`, `PROJECT_TAG`).
- Keep strict default isolation (`tagsMatch: all`) unless you intentionally relax it.
- Add `queryMaxChars` when prompt size/latency is a concern.
- Use non-default bank IDs for hybrid/frontier/shared deployments.
