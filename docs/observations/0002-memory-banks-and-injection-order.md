# Observation 0002: memory banks + injection order

## purpose
small evidence pass for the memory setup after the split-bank wiring.

i am **not** trying to define the full memory contract here.
i am trying to verify the banks are actually operational and that the injection order is sane.

## target test
check the current split-memory behavior in a real run:
- procedural bank is active
- personal bank is active
- corroborator recalls personal first, then procedural
- working peers recall procedural only
- retain paths land in the right bank(s)

## what to look at
primary artifacts:
- `runDir/data/memory/receipts/**`
- `runDir/data/sessions/**`
- `runDir/data/delegation-reports/**`
- traces / console output if needed

## checklist

### 0) recall filter shape
- [x] `tagsMatch` is currently `all` in `pi-agent.json`.
- [x] there is **no config knob for tag templates** yet; the tags are hardcoded in `src/extensions/memoryExtension.ts`.
- [x] current recall tags are `projectTag` + `agent:<name>`.
- [x] current retain tags are `projectTag` + `agent:<name>` + `session:<id>`.
- [x] `types` is the recall isolation knob; current allowlist is `observation`, `world`, `experience`.
- [ ] revisit whether the tag template itself should become configurable so we can widen/narrow recall without changing code.
- [ ] decide later whether tag matching needs to widen or split by bank/role so helpful adjacent memories are not excluded.


### 1) bank setup
- [x] do the receipts show both bank ids in use?
- [x] is the procedural bank `pi-ghosty-procedural`?
- [x] is the personal bank `pi-ghosty-personal`?
- [x] does the run show both banks as live, not just configured?

### 2) injection order
- [x] does corroborator memory show personal before procedural?
- [x] do working peers show procedural only?
- [x] is the separation visible in the injected text / receipt files?
- [x] does the order stay stable across turns?

### 3) retain behavior
- [x] do retain receipts land in the expected bank?
- [x] does corroborator write to both banks when allowed?
- [x] do peers avoid writing personal memories?
- [x] is there any obvious cross-contamination?

### 4) quality check
- [x] does the recalled memory look useful instead of noisy?
- [x] does it avoid stale junk from the botched peer-report era?
- [x] does gemma produce better-looking facts than omnicoder in this path?
- [x] does the memory layer help orientation rather than hijack the task?

### 5) report-shape spillover
- [x] did any botched peer-report content leak into memory in a confusing way?
- [x] if yes, is that a retain problem, a recall problem, or just old junk that should be pruned later?

## notes
keep this one tiny.
if the evidence shows the banks and order are correct, that is enough.
if something is off, note the exact file path and whether it looks like a routing bug, a retain bug, or just stale memory that needs pruning later.