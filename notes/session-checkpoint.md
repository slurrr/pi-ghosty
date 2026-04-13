# Current Goal
- Finish and stabilize the `pi-extension-mode` branch so ghosty runs only when explicitly requested, while preserving the recent dual-config and Pi scoped-model work.

# Current State
- Branch: `pi-extension-mode`.
- Recent branch work, in order:
  - built the Pi extension host (`.pi/extensions/ghosty/index.ts`) with `delegate`, `delegate_batch`, `/ghosty`, `/system`, `/peer open`, tmux peer spawning, routing/catalog enrichment, and per-role tool surfaces.
  - moved peer coordination behavior into role/system prompt shaping and skills, with loop-breaker protections around missing tools and repeated `peer_report`.
  - added per-delegation model override, then per-peer default model support and model-constrained routing.
  - split config handling into runtime (`pi-agent-local.json`) and extension/frontier (`pi-agent-frontier.json`) schemas/loaders, with legacy fallback to `pi-agent.json`.
  - kept Pi `settings.enabledModels` / scoped-model filtering for ghosty peer model resolution.
- The session crash/regression was most likely tied to Pi resume or hot reload reloading the project-local extension from `.pi/extensions/ghosty`, causing ghosty behavior to appear in plain `pi` sessions.
- Recovery work completed locally:
  - `.pi/extensions/ghosty/index.ts` now exits early unless this exact extension was explicitly requested, or `GHOSTY_EXTENSION_ACTIVE=1` is present for intentional child launches.
  - spawned peer tmux windows export both `GHOSTY_AGENT_CONFIG_PATH` and `GHOSTY_EXTENSION_ACTIVE=1`.
  - `scripts/smoke-pi-extension.mjs` exports the same env so smoke runs still exercise ghosty.
  - active ghosty sessions set a footer status `ghosty: active`.
  - status output now shows config path plus scoped/enabled model info.
- Working tree also includes docs/example updates for the dual-config split:
  - `.env.example`, `README.md`, `pi-agent-frontier.json`, `pi-agent-local.json`, `src/config/loadConfig.ts`, `src/config/schema.ts`.
- Validation previously passed with frontier config: `npm run typecheck` and `npm run smoke:pi-ext`.
- Follow-up stabilization direction changed: dual-config is now enforced as a hard split, not a gated mixed-mode path.
- `pi-agent-local.json` remains the runtime/local-model config (sampling + extraBody allowed there).
- Ghosty Pi extension now hard-requires frontier config semantics and rejects `pi-agent-local.json` / runtime-only fields at load time instead of trying to gate behavior by provider.
- One small hardening tweak was added after review: the footer status code now tolerates missing `ctx.ui.theme`.

# Decisions
- Keep the scoped-model / `enabledModels` work from `66ac8b3`; do not roll it back unless a more specific regression is proven.
- Fix the plain-`pi` contamination at extension activation time instead of reverting branch work.
- Treat `.pi/extensions/ghosty` auto-discovery as expected Pi behavior; ghosty itself must fail closed unless explicitly launched with `-e .pi/extensions/ghosty/index.ts`.
- Use a small footer indicator (`ghosty: active`) as the authoritative UI signal that ghosty is actually active.
- Keep `delegate`, `delegate_batch`, and `peer_report` as the core extension tool contract.

# Open Problems
- The exact upstream Pi resume/hot-reload path that reloaded the project extension during plain `pi` use is still not isolated; current fix is defensive rather than root-causing Pi internals.
- Need real-world verification that:
  - plain `pi` from repo root stays vanilla after resume/reload,
  - explicit ghosty launch still works for coordinator and spawned peers,
  - scoped-model filtering behaves correctly with dual-config setups.
- Still need a gap review of what runtime features remain missing from the extension path, but sampling/extraBody are intentionally runtime-only now.

# Resume Instructions
1. Read this file first, then inspect `git diff -- src/config/loadConfig.ts src/config/schema.ts .pi/extensions/ghosty/index.ts scripts/smoke-pi-extension.mjs`.
2. Validate dual-config hard split:
   - `npm run smoke:pi-ext` should pass with frontier config;
   - `GHOSTY_AGENT_CONFIG_PATH=./pi-agent-local.json npm run smoke:pi-ext` should fail immediately with a clear config error.
3. Continue the runtime-vs-extension parity review for features that should exist in the extension path without collapsing the dual-config boundary.
4. Then return to manual plain-`pi` vs explicit-ghosty activation verification if still needed.
