# Current Config Design Direction

## Why this doc exists

This document captures a config direction that fits the code already in the repo and the migration goal of replacing the old runtime with the Pi extension implementation.

It is intentionally grounded in the current code rather than inventing a new architecture from scratch.

## What the code already does today

### Old runtime already supports

The legacy runtime path already has:

- per-agent tool surfaces
- per-agent `thinkingLevel`
- per-agent `defaultModel`
- local-model request shaping via:
  - `defaults.sampling`
  - `agents.<role>.sampling`
  - `agents.<role>.extraBody` / `extra_body`
- deterministic routing controls under `defaults.routing`
- semantic session routing and reuse
- a dedicated local router model path
- memory, tool policy, tool gating, loop breaker, debug extensions, and explicit peer-addressing extensions

### Extension already supports

The Pi extension path already has:

- explicit activation guard
- `/ghosty`, `/system`, and `/peer open`
- `delegate` and `delegate_batch`
- `peer_report` integration for peers
- per-role tool surfaces
- per-delegation model override
- per-agent `defaultModel`
- model-constrained routing
- use of Pi `settings.enabledModels` via `SettingsManager.getEnabledModels()` as the active model allowlist
- status output that shows:
  - config path
  - enabled model patterns
  - allowed model count
- tmux peer opening with inherited extension/config env
- extension-side routing and semantic enrichment driven by the currently selected Pi model

### Important current truth

The extension is **already** using Pi `enabledModels` / `/scoped-models` as the canonical available-model list.

That is the right direction.

Config should not fight this by introducing a second authoritative allowlist.

## Core design constraints

The config must support all of these simultaneously:

1. Preserve local-model behavior from the old runtime.
   - local models still need sampling and provider-specific payload shaping
2. Add frontier models cleanly.
   - frontier models must coexist in the same orchestrator
   - frontier models should not receive local-only request shaping
3. Support hybrid operation.
   - frontier corroborator must still be able to delegate to local peers
   - local corroborator must still be able to delegate to frontier peers
4. Keep Pi `enabledModels` as the canonical availability/scope mechanism.
5. Allow easy role defaults and model overrides.
   - per-agent preferred model
   - per-delegation explicit model override
   - routing can still choose or constrain model usage
6. Allow temporary local-only or frontier-only operation without hardcoding mode switches into ghosty itself.

## What config should own vs what Pi settings should own

### Pi settings should own

Pi settings, especially `enabledModels`, should remain the canonical source for:

- which models are currently available for use
- whether the current session is effectively:
  - local-only
  - frontier-only
  - hybrid

This is already exposed in Pi through `/scoped-models`.

That means:

- local-only mode can be achieved by scoping `enabledModels` to local patterns like `vllm/*`
- frontier-only mode can be achieved by scoping `enabledModels` to frontier patterns
- hybrid mode can be achieved by including both classes of models

Ghosty should not introduce a second full model-management surface or a second canonical allowlist.

### Ghosty config should own

Ghosty config should describe:

- project/runtime defaults
- routing behavior
- per-agent tool surfaces
- per-agent preferred/default models
- provider/model-specific request shaping
- optional presets/helpers that write Pi `enabledModels`

Ghosty config should **not** become a competing availability authority.

## Direction: unify config again

The split between `pi-agent-local.json` and `pi-agent-frontier.json` should be treated as transitional, not the long-term design.

The target should be a **single canonical config universe**.

That does **not** mean one giant flat blob.
It means one schema with clear separation of concerns.

## Recommended shape

The cleanest shape that matches current code and likely future needs is:

1. keep agent-level defaults
2. keep routing config
3. introduce model/provider-specific request shaping rules
4. optionally introduce `enabledModels` presets, but only as helpers, not as the canonical state

## Why not split by file/mode

A file-level split such as:

- local config file
- frontier config file

breaks hybrid orchestration because:

- corroborator model/provider and peer model/provider are independent concerns
- one session may need both frontier and local models in the same delegation tree
- request shaping needs to follow the actual model used, not the config filename

The correct unit of behavior is:

- the model/provider actually used for a given session/role/task

not:

- which config file happened to launch ghosty

## Recommended schema concept

### 1. Keep current agent structure

The current agent config shape is good and should stay conceptually intact:

```json
{
  "agents": {
    "corroborator": {
      "tools": ["read", "grep", "find", "ls", "delegate", "delegate_batch"],
      "thinkingLevel": "off",
      "defaultModel": "openai-codex/gpt-5.3-codex"
    },
    "coder": {
      "tools": ["read", "grep", "find", "ls", "edit", "write", "bash"],
      "thinkingLevel": "off",
      "defaultModel": "vllm/omnicoder-9b"
    }
  }
}
```

This already matches the current extension behavior around per-peer default models.

### 2. Keep routing under defaults

The current `defaults.routing` shape is already useful and should remain the home for:

- max parallel delegations
- semantic routing knobs
- compaction thresholds
- session reuse limits

### 3. Move request shaping away from file-mode semantics

The important missing abstraction is that local-only request shaping currently lives as if it were global config mode.

Instead, request shaping should attach to model/provider matches.

A clean direction is a `requestRules` section.

Example:

```json
{
  "requestRules": [
    {
      "when": {
        "model": ["vllm/*"]
      },
      "apply": {
        "sampling": {
          "temperature": 0.6,
          "topP": 0.95,
          "topK": 20,
          "minP": 0.05,
          "repetitionPenalty": 1.0
        }
      }
    },
    {
      "when": {
        "agent": ["corroborator"],
        "model": ["vllm/*"]
      },
      "apply": {
        "sampling": {
          "temperature": 1.1,
          "topP": 1.0,
          "topK": -1,
          "minP": 0.05,
          "presencePenalty": 0.9
        },
        "extra_body": {
          "chat_template_kwargs": {
            "enable_thinking": false
          }
        }
      }
    }
  ]
}
```

### Why this fits the repo

This works with the current direction because:

- local-only knobs are still expressible
- frontier models simply do not match those rules
- hybrid sessions work naturally
- per-agent overrides stay possible
- the logic follows the actual model used, not a config file name

## Backward compatibility / migration strategy

To avoid fighting the current code, the implementation can support a staged migration:

### Stage 1: keep existing keys as shorthand

Continue accepting:

- `defaults.sampling`
- `agents.<role>.sampling`
- `agents.<role>.extraBody`
- `agents.<role>.extra_body`

But treat them internally as shorthand for request rules targeting local models.

That preserves existing behavior while introducing a more correct abstraction underneath.

### Stage 2: add explicit request rules

Add `requestRules` as the canonical internal model.

The loader can normalize old shorthand into rule objects.

### Stage 3: eventually de-emphasize shorthand

Once extension parity is solid, docs can prefer `requestRules` while still supporting shorthand if desired.

## `enabledModels` should remain canonical, but ghosty can help manage it

Since `enabledModels` is already the live model scope used by Pi and the extension, ghosty should treat it as canonical.

However, ghosty can still offer config-driven conveniences without replacing it.

## Recommended helper concept: scope presets

Instead of a second allowlist, config can define **presets** for writing or applying `enabledModels`.

Example:

```json
{
  "modelScopePresets": {
    "local-only": ["vllm/*"],
    "frontier-only": ["openai-codex/*"],
    "hybrid-default": ["openai-codex/*", "vllm/*"]
  }
}
```

These presets are not the active truth by themselves.
They are helpers for updating Pi settings.

## Extension UX opportunity

Ghosty should not recreate `/scoped-models`.

The only extension-level UX worth adding here is a light convenience layer around presets and status.

Reasonable future commands:

- `/ghosty models`
  - show current scoped model state and relevant ghosty defaults
- `/ghosty models preset <name>`
  - apply a configured preset to Pi `enabledModels`

Less desirable additions that should be avoided unless there is a strong later need:

- a second full add/remove model UI
- a ghosty-private allowlist layered under `enabledModels`
- a second canonical concept of "ghosty models"

Implementation target:

- use `SettingsManager` to apply/update `enabledModels`
- keep Pi `enabledModels` as the single source of truth

This gives ghosty a clean way to help with scope selection while still honoring Pi’s native settings model.

## Recommended canonical config shape

A likely target shape looks like this:

```json
{
  "defaults": {
    "projectTag": "project:pi-ghosty",
    "runtime": {
      "vllmBaseUrl": "http://localhost:8002/v1",
      "hindsightBaseUrl": "http://localhost:8888",
      "hindsightBankId": "pi-ghosty",
      "model": {
        "contextWindow": 131072,
        "maxTokens": 8192
      }
    }
  },
  "agents": {
    "corroborator": {
      "tools": ["read", "grep", "find", "ls", "delegate", "delegate_batch"],
      "thinkingLevel": "off",
      "defaultModel": "openai-codex/gpt-5.3-codex"
    },
    "coder": {
      "tools": ["read", "grep", "find", "ls", "edit", "write", "bash"],
      "thinkingLevel": "off",
      "defaultModel": "vllm/omnicoder-9b"
    },
    "researcher": {
      "tools": ["read", "grep", "find", "ls"],
      "thinkingLevel": "off",
      "defaultModel": "openai-codex/gpt-5.3-codex"
    },
    "reviewer": {
      "tools": ["read", "grep", "find", "ls"],
      "thinkingLevel": "off",
      "defaultModel": "vllm/omnicoder-9b"
    },
    "memory": {
      "tools": ["read", "grep", "find", "ls"],
      "thinkingLevel": "off"
    }
  },
  "requestRules": [
    {
      "when": {
        "model": ["vllm/*"]
      },
      "apply": {
        "sampling": {
          "temperature": 0.6,
          "topP": 0.95,
          "topK": 20,
          "minP": 0.05,
          "repetitionPenalty": 1.0,
          "presencePenalty": null,
          "frequencyPenalty": null
        }
      }
    },
    {
      "when": {
        "agent": ["corroborator"],
        "model": ["vllm/*"]
      },
      "apply": {
        "sampling": {
          "temperature": 1.1,
          "topP": 1.0,
          "topK": -1,
          "minP": 0.05,
          "presencePenalty": 0.9
        },
        "extra_body": {
          "chat_template_kwargs": {
            "enable_thinking": false
          }
        }
      }
    }
  ],
  "routing": {
    "defaults": {
      "maxParallelDelegations": 2,
      "maxNumSeqHint": 4,
      "maxLoadedSessionsTotal": 8,
      "maxLoadedSessionsPerPeer": 4,
      "compactThresholdPercent": 75,
      "retireAfterCompactions": 5,
      "semantic": {
        "enabled": true,
        "updateCooldownMs": 3600000,
        "maxCandidates": 8,
        "model": "default"
      }
    },
    "budgetGuards": {
      "maxDelegationsPerUserTurn": 8,
      "maxNewSessionsPerUserTurn": 4,
      "maxFrontierDelegationsPerUserTurn": 4
    }
  },
  "routingRules": [
    {
      "when": {
        "model": ["vllm/*"]
      },
      "apply": {
        "maxParallelDelegations": 2,
        "maxNumSeqHint": 4,
        "maxLoadedSessionsTotal": 8,
        "maxLoadedSessionsPerPeer": 4
      }
    },
    {
      "when": {
        "model": ["openai-codex/*"]
      },
      "apply": {
        "maxParallelDelegations": 8,
        "maxNumSeqHint": 12
      }
    }
  ],
  "modelScopePresets": {
    "local-only": ["vllm/*"],
    "frontier-only": ["openai-codex/*"],
    "hybrid-default": ["openai-codex/*", "vllm/*"]
  }
}
```

## Why this shape is not "openclaw.json"

This shape stays manageable because it separates concerns:

- `defaults` = global behavior and runtime services
- `agents` = role defaults and tools
- `requestRules` = provider/model-specific request shaping
- `routing.defaults` = baseline orchestration behavior
- `routingRules` = model-sensitive routing tuning
- `routing.budgetGuards` = safety limits against runaway usage
- `modelScopePresets` = convenience helpers for Pi `enabledModels`

That keeps the config aligned with the actual implementation boundaries.

## What still needs to be ported from runtime to extension

Based on the code today, major remaining functional gaps include:

1. request shaping logic needs to become model-aware rather than file-mode-aware
2. routing config needs to grow beyond a single static baseline so hybrid workflows can tune local vs frontier behavior cleanly
3. memory behavior from the runtime path is not yet fully represented in the extension path
4. loop-breaker behavior from runtime is not yet fully mirrored in the extension path and should be improved, not copied verbatim
5. explicit peer-addressing and some debug behaviors are still runtime-biased
6. runtime currently has a dedicated local router model path, while the extension uses the active Pi model for routing/semantic asks
7. there is no ghosty-native preset/status layer yet for helping manage `enabledModels`

Not everything from the old runtime should be ported literally.

Functional parity is the goal, not duplicating runtime-only guardrails that Pi already handles well.

In particular, redundant tool-policy/tool-permission layers should be re-evaluated critically instead of being assumed necessary in the extension.

## Recommended next implementation order

1. stop treating split config files as the architectural destination
2. define a unified schema in code, keeping compatibility shims for the current fields
3. normalize old sampling/extra_body fields into model-matched request rules internally
4. add `routing.defaults`, `routingRules`, and `routing.budgetGuards` in a way that can preserve current static behavior while enabling hybrid tuning
5. port request-shaping behavior into the extension using actual model/provider matching
6. add optional scope preset support for Pi `enabledModels`
7. continue functional parity work for memory, loop-breaker behavior, and only the runtime guardrails that Pi does not already provide
8. retire the old runtime only after the extension fully covers those responsibilities

## Bottom line

The correct long-term model is:

- one ghosty config universe
- Pi `enabledModels` as the canonical available-model scope
- per-agent default models for orchestration intent
- `requestRules` as the canonical request-shaping mechanism
- shorthand sampling/extra-body keys kept only as transitional input and normalized internally
- `routing.defaults` plus model-matched `routingRules`
- separate budget guardrails for runaway frontier usage
- optional ghosty presets/helpers for local-only, frontier-only, and hybrid scopes

That direction matches both the current code and the intended Pi-native future.
