# Architecture Comparison: Standalone pi-ghosty Runtime vs “Pure Pi” Extension

This doc compares two viable architectures for **pi-ghosty** given the original intent: *“use everything we can from pi-mono; keep custom code as light glue; preserve vanilla `pi` on the machine.”*

It’s written to answer:
- Should we keep owning a standalone runtime (`tsx src/index.ts`)?
- Or should we rebuild ghosty as **a project-local Pi extension / pi package** and run upstream `pi` as the harness?
- What breaks, what becomes easier, and what can/can’t be done without upstream changes?

References:
- Current standalone notes: `docs/reference/architecture.md`
- “Pure extension” outline: `docs/reference/architecture_as_pi_ext.md`

---

## 1) What you’re trying to do (constraints distilled)

You want a **personal agent harness** that:

1. **Feels like vanilla Pi**
   - OAuth login + provider catalogs
   - session tree, /new, /resume, /model, /settings, etc.
   - stable interactive UX

2. **Adds Ghosty-specific capabilities**
   - multi-peer orchestration (corroborator + specialist peers)
   - concurrency (`delegate_batch`), routing, session catalog
   - strict peer-report contract + structured results
   - heavy observability/tracing
   - optional memory (Hindsight)

3. **Minimizes “reinvent pi” drift**
   - avoid re-implementing things already built in Pi
   - reduce maintenance when upstream changes
   - keep a path to upgrade pi-mono without archaeology

4. **Keeps vanilla Pi usable**
   - you still want to run `pi` as a normal coding agent harness
   - ghosty shouldn’t require patching or replacing upstream `pi`

---

## 2) Options

### Option A — Standalone runtime (current)
**You run** `npm run dev` / `tsx src/index.ts`.

Ghosty:
- constructs sessions via `@mariozechner/pi-coding-agent` services
- embeds/starts a TUI (`src/tui/startTui.ts`)
- implements orchestration/runtime state itself (`src/runtime/*`)
- registers a local vLLM provider in code
- uses in-memory auth storage today

### Option B — “Pure Pi” extension/package (run upstream `pi`)
**You run** upstream `pi` in this repo, and ghosty loads as an extension.

Ghosty becomes:
- `.pi/extensions/ghosty/index.ts` (or an installable pi package)
- registers tools (`delegate`, `delegate_batch`, `peer_report`, routing helpers)
- manages worker peer sessions using Pi’s session APIs
- uses Pi’s AuthStorage + ModelRegistry (OAuth “just works”)
- relies on Pi TUI/session tree/settings for user-facing UX

---

## 3) Cost/Benefit Matrix (high level)

| Dimension | Option A: Standalone runtime | Option B: Pure Pi extension |
|---|---|---|
| **OAuth / provider catalogs** | You must wire it (AuthStorage, ModelRegistry). Easy-ish but extra work. | Already built-in. `/login` works; credentials in `~/.pi/agent/auth.json`.
| **Session tree + UX** | You’ll keep chasing Pi feature parity (tree, model picker, settings UI, session search). | Free: you get Pi’s UX immediately.
| **Multi-peer orchestration** | Full control; you already built it. | Possible, but needs careful integration with Pi session APIs (see risks).
| **Concurrency / delegate_batch** | You already own concurrency; can tune it for your hardware. | Still possible inside an extension, but you must ensure you can create/drive multiple sessions without UI confusion.
| **Routing/catalog/semantic enrichment** | Already implemented; stable under your control. | Can be kept; but needs robust storage + careful use of Pi session metadata.
| **Upstream break risk** | Medium: you depend on internal-ish behaviors, and you duplicate features that will diverge. | Medium-Low: if you stick to extension APIs. Risk shifts to extension API stability.
| **Maintenance effort** | High ongoing: every time you want a Pi feature, you re-add it. | Lower ongoing: focus on ghosty-specific logic; Pi provides the rest.
| **Testing/CI determinism** | Better: you control the whole harness; can run headless. | Harder: Pi is interactive-first; still testable but more integration-y.
| **Isolation / “safe mode”** | Easy: you can hard-disable network providers; keep everything local by default. | Also easy: default provider is local; extension can enforce.
| **“Vanilla Pi” coexistence** | Already coexists (separate `npm run dev` app). | Best coexistence: you *are* running vanilla `pi` + extension.

---

## 4) The core tradeoff

### The reason you *feel* you’re reinventing Pi
Because Option A makes you responsible for:
- auth flows (/login)
- provider catalogs + model selection
- session tree UX
- settings persistence
- command surface parity

Even if you reuse Pi packages internally, **you’re still rebuilding the product surface**.

### The reason Option B isn’t automatically “free”
Because ghosty’s differentiator is **multi-session orchestration**.

Pi is fundamentally “one interactive session at a time”, and while it supports sessions, the extension API must make it possible to:
- create/resume peer sessions in separate directories
- drive them programmatically (send them prompts)
- capture their results reliably
- do this concurrently
- without polluting or confusing the user’s session tree

This is doable, but the details matter.

---

## 5) What you likely *cannot* do cleanly as an extension (without upstream changes)

This is the important “now or never” part.

### 5.1 True background/concurrent peer turns while staying in the corroborator TUI
Ghosty today can dispatch parallel work because it owns the runtime and tool loop.

In a pure extension, you must confirm the extension API supports:
- starting LLM calls for other sessions “in the background”
- awaiting them while the corroborator turn is still processing

If Pi’s extension system only allows work inside the current turn pipeline (single-threaded), you can still do concurrency internally (Promises), but you must ensure the underlying session execution supports it.

**Risk:** You may discover the extension surface doesn’t expose a stable “run another session programmatically” API, or it exists but is not considered public/stable.

### 5.2 Managing multiple persistent peer sessions without cluttering the human session tree
You probably want:
- “corroborator session” visible/primary
- “peer sessions” mostly invisible/background, but persistent

Pi’s session tree is user-facing. If peers show up like normal sessions, the UI could get noisy.

**If Pi can’t hide sessions**, you’ll either:
- accept that peers appear as sessions (fine, but could be annoying)
- or you’ll need upstream support for “hidden/system sessions”

### 5.3 Custom routing + catalog as a first-class session primitive
You can store routing metadata in your own files today.

In Pi, session metadata primitives may be limited to `session_info` and whatever is persisted in Pi’s session manager. If you want richer metadata displayed/searchable in Pi, you may need upstream changes.

(You can still store your own `session-catalog.json`, but it won’t automatically integrate with Pi’s session search UI.)

### 5.4 Tight control over provider request shaping for every session
You already do things like vLLM `extra_body` merging and router-specific response_format.

Pi supports a lot of this, but if you need very custom request patching per peer per call, an extension can do it (via provider request hooks) but you must verify those hooks exist in the extension API surface you get from `pi`.

---

## 6) What becomes dramatically easier in Option B

### 6.1 OAuth + model catalogs
You get:
- `/login`, `/logout`
- token refresh
- provider catalogs
- `/model` browsing
- credential storage rules

This directly solves your immediate “OAuth + gpt-5.4-only benchmark” requirement.

### 6.2 Session UX parity
Pi already has:
- session creation/resume primitives
- session tree, naming conventions
- settings UX
- (depending on Pi version) better ergonomics for switching contexts

If you want “vanilla Pi + ghosty orchestration”, using Pi as the harness is the shortest path.

### 6.3 Lower duplication = lower long-term maintenance
A lot of your current work is reintroducing Pi features a second time.

Option B reduces future work to mostly:
- orchestration tools
- peer/session management glue
- routing/caching logic

---

## 7) What becomes easier in Option A (reasons to keep owning runtime)

Option A still has legitimate benefits.

### 7.1 Deterministic orchestration + observability
Because you own the runtime:
- you can guarantee your tool contract semantics
- you can enforce concurrency and timeouts exactly
- you can store traces exactly how you want

### 7.2 “Headless” automation
If you later want to run ghosty in scripts/cron/CI without a human TUI:
- Option A is naturally suited
- Option B can do it, but Pi is interactive-first

### 7.3 You can evolve beyond Pi’s conceptual model
If you plan future features like:
- background daemons
- long-running autonomous peer agents
- scheduled reflection jobs
- distributed peers across machines

Owning runtime avoids fighting the harness.

### 7.4 You can pin and encapsulate upstream changes
If you treat Pi packages as libraries and pin versions, you can keep the behavior stable for long stretches.

(But: you still face drift when you need new upstream features.)

---

## 8) The real decision: What is the “product surface”?

You are building a personal harness that you want to *feel like Pi*.

If Pi’s UX (tree, login, models, settings) is part of the product, then **Option B is the natural architecture**.

If Ghosty’s orchestration is the product and Pi is just a library, Option A is fine—but you will keep reimplementing UX and auth.

---

## 9) Recommended architecture (pragmatic)

### Recommendation: move toward Option B, but keep a fallback path
Given your stated priorities (“I want everything from pi, vanilla pi on the machine, stop re-adding built-ins”), the best architecture is:

1. **Primary mode: Pure Pi extension/package**
   - Run upstream `pi`.
   - Load ghosty via `.pi/extensions/ghosty` (or a pi package).
   - Use Pi auth + models + UI.

2. **Secondary mode: thin standalone harness (optional)**
   - Keep `src/index.ts` only if you need headless automation or experiments.
   - Treat it like a dev/test harness, not the main product.

This is not “fork pi”. It’s “use pi as intended”. You keep vanilla Pi unchanged.

---

## 10) Migration plan (incremental, low regret)

### Phase 0 — Stop digging (immediately)
Before adding more “Pi features” to ghosty’s standalone runtime, decide whether those features are *harness concerns*.

If yes, prefer migrating to extension instead of re-adding them.

### Phase 1 — Get OAuth + model selection without a rewrite
Short-term unblock even if you haven’t migrated:
- switch `AuthStorage.inMemory()` to `AuthStorage.create()`
- stop hard-registering only vLLM
- allow selecting provider+model from config

This alone gets you OAuth benchmarking.

### Phase 2 — Move orchestration tools into a Pi extension
- implement `delegate`, `delegate_batch`, `peer_report` in `.pi/extensions/ghosty`
- reuse existing runtime modules where possible (router, catalog store, concurrency)
- keep storage in `~/runs/pi-ghosty` as today

### Phase 3 — Peer session strategy
Decide how peers map to Pi sessions:
- separate session dirs per peer under runDir (recommended)
- “hidden/system session” if upstream supports it
- or accept peer sessions in the tree

### Phase 4 — Reduce/retire standalone harness
Once the extension mode is stable:
- keep standalone only if you truly need headless/daemon behavior
- otherwise remove TUI embedding and “product” logic from Option A

---

## 11) Vanilla Pi coexistence

Option B is actually the best answer to this.

- You keep upstream `pi` installed normally.
- In the `pi-ghosty` repo, you run `pi` *inside the repo* so it picks up `.pi/extensions/ghosty` and `.pi/APPEND_SYSTEM.md`.
- Outside the repo, `pi` behaves normally.

No fork required.

---

## 12) Bottom line

### If you want “Pi + peers” as your daily driver
Move to **Pure Pi extension**. It aligns with:
- OAuth
- session tree
- minimal duplication
- long-term ergonomics

### If you want a research platform that may outgrow Pi’s UX model
Keep owning runtime, but accept you’ll keep re-implementing harness features.

### My call given your stated pain
You’re at the point where each new requirement (“OAuth”, “session tree”, “settings”) increases the gravitational pull toward Option B.

If you don’t pivot now, you will likely continue paying the “rebuild Pi” tax indefinitely.

---

## Appendix: Concrete open questions to answer *before* committing fully to Option B

1. Can an extension reliably create/resume and drive other sessions programmatically (without unstable imports)?
2. Can we run multiple peer completions concurrently without breaking Pi’s execution model?
3. Can we keep peer sessions from cluttering the user’s session tree (or is that acceptable)?
4. Are there hooks to enforce tool gating/policy in extension mode at the same level as today?

If the answer to (1) or (2) is “no without upstream changes”, then the hybrid approach (Option B primary + small upstream PRs) is the best route.
