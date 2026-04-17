# Launch from any directory spec (pi-ghosty)

## Objective
Allow starting pi-ghosty from **any caller working directory** without `cd` into repo, while anchoring all ghosty project-relative paths to the pi-ghosty repo root.

Requirements:
- Preserve caller CWD as shell launch point / work sandbox by default.
- Resolve config + `.pi` assets + skills + traces from explicit project root.
- Provide explicit env override for trusted/no-sandbox mode.
- Keep change minimal and robust.
- Extension mode is the standard path.

---

## Recommended mechanism (smallest robust change)

Use two explicit env vars:

- `GHOSTY_PROJECT_DIR=/absolute/path/to/pi-ghosty` (project anchor)
- `GHOSTY_WORKDIR_MODE=sandbox|trusted` (sandbox policy)

and make launcher scripts set them automatically from script location + defaults.

### Why env var (vs new CLI flag)
- Works for both Node runtime entrypoints and Pi extension subprocesses.
- No changes needed to Pi CLI argument parsing.
- Easy to propagate through tmux/peer-open/spawned processes.
- Keeps implementation small and explicit.

---

## Path model

Two roots, intentionally separate:

1. **projectDir** (ghosty repo root)
   - source of truth for:
     - `pi-agent-canonical.json`
     - `.pi/extensions/ghosty/index.ts`
     - `.pi/APPEND_SYSTEM.md`
     - `.pi/skills/**`
     - prompt parts and project assets

2. **workDir** (caller CWD)
   - source of truth for:
     - tool sandbox CWD
     - user-facing shell context
     - files read/write/edit/bash should target caller workspace

Run/traces stay under runDir, but runDir should be anchored consistently from env/config and not implicitly tied to caller CWD.

---

## Resolution rules

### Project root resolution
Introduce a shared resolver used by launchers/runtime:

`resolveGhostyProjectDir({ env, importMetaUrl, fallbackCwd? })`

Order:
1. `GHOSTY_PROJECT_DIR` if set (absolute required; resolve + normalize)
2. Derive from known script location (`import.meta.url`) for launcher-owned files
3. (Optional dev fallback) current behavior for compatibility

Reject missing/invalid root with a clear startup error.

### Config resolution
- Canonical-only implementation target:
  - config path = `${projectDir}/pi-agent-canonical.json`
- In extension mode, still require `GHOSTY_AGENT_CONFIG_PATH`, but wrapper should set it from `projectDir` by default.

### Extension path resolution
- Extension path must be built from `projectDir`, never caller CWD.

### `.pi` asset resolution
- Always `resolve(projectDir, ".pi", ...)`.
- Never relative to caller CWD.

### Work/sandbox resolution
- Default: `GHOSTY_WORKDIR_MODE=sandbox`
  - `workDir = caller process.cwd()`
- Override: `GHOSTY_WORKDIR_MODE=trusted` (also accepts `no-sandbox` alias)
  - `workDir = projectDir`
- Pass resolved `workDir` into runtime/session creation.

### Run dir anchoring
- Keep existing `GHOSTY_RUN_DIR` / `GHOSTY_PI_RUN_DIR` behavior.
- If unset, use existing home-based defaults; do not derive from caller CWD.

---

## File targets

## 1) Launcher script (extension standard path)
- `scripts/dev-pi-extension.mjs`

Changes:
- compute `projectDir` from script file location (`import.meta.url`), not `process.cwd()`.
- keep `callerCwd = process.cwd()` for sandbox default.
- resolve launch CWD from `GHOSTY_WORKDIR_MODE`:
  - sandbox => callerCwd
  - trusted/no-sandbox => projectDir
- set env for child `pi` process:
  - `GHOSTY_PROJECT_DIR=<resolved projectDir>`
  - `GHOSTY_WORKDIR_MODE=<sandbox|trusted>`
  - `GHOSTY_AGENT_CONFIG_PATH=<projectDir>/pi-agent-canonical.json` (unless explicitly overridden)
- resolve extension path from projectDir.

## 2) Runtime entrypoint
- `src/index.ts`
- `src/tui/startTui.ts`

Changes:
- stop hardcoding `/home/.../pi-ghosty`.
- use shared project resolver (env first).
- resolve `workDir` from `GHOSTY_WORKDIR_MODE` (sandbox default, trusted override).

## 3) Config loader
- `src/config/loadConfig.ts`

Changes:
- no broad behavior change required.
- add a canonical-focused helper if needed (`loadCanonicalConfig(projectDir)`) to make intent explicit.
- legacy resolution can remain for compatibility, but canonical path should be used by standard launcher path.

## 4) Session creation/runtime wiring
- `src/pi/createSession.ts`
- `src/runtime/ghostyRuntime.ts`

Changes:
- mostly none; already receive `projectDir` and `workDir` separately.
- verify all `.pi` resource loader paths use `projectDir` only.

## 5) Extension mode propagation
- `.pi/extensions/ghosty/index.ts`

Changes:
- optional: respect `GHOSTY_PROJECT_DIR` for consistency checks/logging.
- when spawning peer windows (`/peer open`), propagate:
  - `GHOSTY_PROJECT_DIR`
  - `GHOSTY_WORKDIR_MODE`
  - `GHOSTY_AGENT_CONFIG_PATH`
  - existing run-dir env
- if mode is trusted, prefix peer launch command with `cd <projectDir>` so peer windows inherit no-sandbox behavior.

---

## Behavior after change

From any directory:

```bash
cd /tmp
node /home/poop/code/dev/pi-ghosty/scripts/dev-pi-extension.mjs
```

- ghosty uses project assets/config from `/home/poop/code/dev/pi-ghosty`
- tools still operate in `/tmp` (caller CWD)
- sessions/traces go to configured runDir

---

## Acceptance criteria

1. Launching from outside repo succeeds without `cd`.
2. `workDir` remains caller CWD for tools.
3. Config + `.pi` assets resolve from repo root.
4. Extension mode (`pi -e ...`) works with explicit root/config env.
5. `/peer open` spawned windows preserve same root/config anchoring.
6. No regressions in `npm run smoke:pi-ext` and typecheck.

---

## Notes
- This spec intentionally avoids adding a new user-facing CLI flag.
- `GHOSTY_PROJECT_DIR` is the minimal explicit contract that works across scripts, runtime, and extension subprocesses.
- Canonical config remains the implementation target; local/frontier configs remain reference-only until memory stabilization.
