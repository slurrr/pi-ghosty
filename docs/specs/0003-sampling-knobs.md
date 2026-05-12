# Spec: Sampling knobs in `pi-agent.json`

## Goal
Make LLM sampling behavior stable and tunable **via config only** (no env vars yet), with the ability to set different sampling for corroborator vs worker peers.

This is intended to address quality drift caused by provider/server defaults (vLLM/OpenAI-compat), and to support role-specific behavior (e.g. low-temp workers, higher-temp corroborator).

## Non-goals
- No mid-run / per-request sampling changes.
- No env var overrides.
- No UI commands for sampling.
- No provider-specific advanced knobs beyond a small, safe set.

## Configuration

### Shape
Add `sampling` under both `defaults` and per-agent config:

```jsonc
{
  "defaults": {
    "model": {
      "contextWindow": 131072,
      "maxTokens": 8192
    },
    "sampling": {
      "temperature": 0.2,
      "topP": 0.95,
      "topK": 40,
      "minP": 0.05,
      "repetitionPenalty": 1.05

      // Optional later:
      // "seed": 1234,
      // "stop": ["\n\nUser:"]
    }
  },
  "agents": {
    "corroborator": {
      "tools": ["read", "grep", "find", "ls", "delegate"],
      "thinkingLevel": "off",
      "sampling": {
        "temperature": 0.7,
        "topP": 0.95
      }
    },
    "coder": {
      "tools": ["read", "grep", "find", "ls", "edit", "write", "bash"],
      "thinkingLevel": "off",
      "sampling": {
        "temperature": 0.15,
        "topP": 0.9
      }
    }
  }
}
```

### Supported fields (v1)
Target: **vLLM 0.18.0** OpenAI-compatible server.

For vLLM 0.18.0, the server-wide generation defaults path (`generation_config`) and the model config code path explicitly recognize these sampling keys:
- `repetition_penalty`
- `temperature`
- `top_k`
- `top_p`
- `min_p`
- `max_new_tokens` (already in config via `defaults.model.maxTokens`)

Accordingly, v1 supports these config fields:
- `temperature` (number) → request `temperature`
- `topP` (number) → request `top_p`
- `topK` (integer) → request `top_k`
- `minP` (number) → request `min_p`
- `repetitionPenalty` (number) → request `repetition_penalty`

Note on max tokens: we already control max new tokens via `defaults.model.maxTokens`. In OpenAI-compatible requests this is typically sent as `max_tokens`; vLLM maps it to its internal `max_new_tokens`.

### Optional fields (v2, not implemented in v1)
- `seed` (integer)
- `stop` (string | string[])
- OpenAI-style penalties (`presence_penalty`, `frequency_penalty`) — only if we explicitly decide to support them for non-vLLM providers.

## Merge / precedence
Sampling values are resolved per agent session:

1. start with `defaults.sampling` (if present)
2. overlay `agents[agentName].sampling` (if present)

If a field is missing at both levels, it is omitted from provider requests (provider/server default applies).

## Application

### Where applied
Sampling must be injected into the outbound provider request payload for each LLM call.

Implementation should use an extension hook:
- `before_provider_request` event

Rationale:
- Centralized enforcement
- Applies to all turns for that session
- Compatible with a future migration to “pure pi extension/package” architecture

### Payload mapping
When payload matches OpenAI chat/completions-like shape, set:
- `temperature` → `payload.temperature`
- `topP` → `payload.top_p`
- `topK` → `payload.top_k`
- `minP` → `payload.min_p`
- `repetitionPenalty` → `payload.repetition_penalty`

Collision policy (v1):
- If the payload already has an explicit value for a field, **do not override** it.
  - (We can add a `force: true` later if needed.)

## Validation
Update `src/config/schema.ts` to validate:
- `temperature`: `0 <= x <= 2`
- `topP`: `0 < x <= 1`
- `topK`: integer `>= 1`
- `minP`: `0 <= x <= 1`
- `repetitionPenalty`: `>= 1`

All sampling objects should be optional so existing configs remain valid.

## Observability
When `GHOSTY_DEBUG_ALL=1` (or a future dedicated flag), write a one-time per-session trace event:

- `type: "sampling_config"`
- `agentName`, `sessionId`, `projectTag`
- `resolvedSampling`: resolved values actually used for that agent

This should go to the existing agent trace JSONL:
- `~/runs/pi-ghosty/data/traces/<agentName>/<sessionId>.jsonl`

## Acceptance criteria
- With `defaults.sampling` set, corroborator and peers produce measurably more stable outputs across runs (no drift from vLLM defaults).
- With per-agent overrides, worker peers behave more deterministic/boring (low temp), corroborator can be more stylistic (higher temp).
- No change in behavior when sampling is absent from config.
