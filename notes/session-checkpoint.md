# Current Goal
- Keep pi-ghosty stable enough to use day to day while the memory stack is under test.
- Use hindsight split-bank memory cleanly: procedural for peers, personal + procedural for coordinator.

# Current State
- Split-bank memory is wired and verified in live receipts/traces:
  - procedural bank: `pi-ghosty-procedural`
  - personal bank: `pi-ghosty-personal`
  - coordinator injects personal first, then procedural
  - peers inject procedural only
- Missions were set via the node scripts and are visible in backend/live memory artifacts.
- `tagsMatch: "all"` remains the recall filter; tag templates are still hardcoded in `src/extensions/memoryExtension.ts`.
- Added a backend status command that queries hindsight directly:
  - `scripts/memory-status.mjs`
  - `npm run memory` / `npm run memory:status`
- Kept the local receipts viewer as:
  - `npm run memory:receipts`
- The old `npm run memory` receipts behavior was replaced because it was noisy / not the best backend check.
- Hindsight previously core dumped under heavy load.
- The crash was a real `SIGSEGV` in native/runtime land, not a clean shutdown.
- Useful coredump facts recorded from `coredumpctl info 3148743`:
  - process: `hindsight-api`
  - signal: `11 (SEGV)`
  - crash point: `gen_dealloc` / `uvloop` idle callback path
  - lots of worker threads parked in `torch/libgomp.so` and `onnxruntime`
  - coredump file exists at `/var/lib/systemd/coredump/core.hindsight-api.1000.033aaa856966415689a83fd610b1c8bb.3148743.1777080086000000.zst`
- The long retain job that likely pushed it over the edge was huge (~99k tokens), with slow retain extraction and consolidation.
- Hindsight is back up after restart and the memory status script works again.

# Decisions
- Treat the crash as an environment / native-stack stability issue, not a repo logic bug.
- Do not keep digging for a surgical fix unless the same crash repeats after the env upgrade.
- Use backend status queries for live config verification; use receipts/traces for behavior verification.
- Keep the checkpoint short and factual so the crash doesn’t get rediscovered from scratch.

# Open Problems
- Decide whether to upgrade/re-pin the inference/memory stack now that a newer vLLM/transformers combo is available.
- Decide whether to add watchdog / auto-restart behavior for hindsight if long retain jobs can still wedge it.
- If the crash repeats, collect coredump metadata first before doing more manual forensics.

# Resume Instructions
1. For live backend config, run `npm run memory:status`.
2. For recent run evidence, run `npm run memory:receipts`.
3. If hindsight dies again, inspect `coredumpctl info <pid>` first, then only do `gdb` if the metadata is still ambiguous.
4. If the env upgrade happens, re-verify split-bank behavior and memory quality after the restart.
