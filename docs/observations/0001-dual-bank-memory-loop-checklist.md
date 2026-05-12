# Observation 0001: Dual-bank memory loop checklist

## Purpose
This checklist is for the first evidence-gathering run on the split-memory work.
The goal is not to define the final workflow contract.
The goal is to inspect the actual artifacts and decide:
- what is already working
- where the current process is too thin
- whether memory is helping or hurting
- what minimum-viable contract fields are actually worth adding

## Target test
Implement and verify the dual-bank memory spec:
- procedural bank
- personal bank
- corroborator recalls from both banks
- working peers recall from procedural only
- traces and receipts show what happened

## Source of truth
Use the current repo state plus:
- `VISION.md`
- `AGENTS.md`
- `.pi/skills/delegate/SKILL.md`
- `.pi/skills/peer-report/SKILL.md`
- `docs/specs/0009-split-banks-personal-procedural-memory-spec.md`

## What to inspect
Primary artifacts:
- `runDir/data/sessions/**`
- `runDir/data/traces/**`
- `runDir/data/delegation-reports/**`
- `runDir/data/memory/receipts/**`
- any console output or smoke output captured during the run

## Observation checklist

### 1) Setup and routing
- [ ] Did the system start with the intended split-bank config?
- [ ] Can we tell which bank ids were used for procedural and personal memory?
- [ ] Can we tell which roles were allowed to recall from which bank?
- [ ] Did the corroborator and peers launch with the expected memory wiring?

### 2) Delegation envelope
- [ ] Did the delegation task sent to coder clearly point at the spec and success criteria?
- [ ] Was the delegation envelope visible enough to reconstruct later?
- [ ] Did the corroborator keep the task bounded instead of overexplaining it?
- [ ] Did the launch artifact identify the peer/session/job clearly enough?

### 3) Peer report shape
- [ ] Did the coder report come back in the current expected shape?
- [ ] Did it say what changed?
- [ ] Did it say what did not change?
- [ ] Did it surface blockers explicitly instead of pretending completion?
- [ ] Could we tell from the report whether the spec was actually met?

### 4) Review loop
- [ ] Did the reviewer get a clean enough handoff to do actual review work?
- [ ] Did review results separate pass/fail from implementation details?
- [ ] If findings came back, were they specific enough to route back to coder without guesswork?
- [ ] Could we tell whether failures were spec gaps, implementation bugs, or report-shape problems?

### 5) Memory behavior
- [ ] Did the corroborator recall from both banks as intended?
- [ ] Did working peers stay out of the personal bank?
- [ ] Did memory injection add useful continuity rather than noise?
- [ ] Did the recalled context help the session stay oriented on the task?
- [ ] Did any recalled memory obviously distort the task shape or pull in stale context?
- [ ] Did traces show the bank/source separation clearly enough to debug?

### 6) Retain behavior
- [ ] Did procedural memories get written where we expected?
- [ ] Did personal memories get written only where allowed?
- [ ] Did the receipts show the retain path clearly enough to audit?
- [ ] Did the system avoid cross-contaminating the two banks?

### 7) Trace evidence
- [ ] Do traces show the prompt/memory path clearly enough to reconstruct the run?
- [ ] Can we see which files, scopes, or receipts were used?
- [ ] Can we tell whether the memory layer is reducing repeated explanation?
- [ ] Can we tell whether memory is adding friction, extra cleanup, or stale context?

### 8) Contract gaps
For every failure or ambiguity, note whether it suggests:
- [ ] a missing field in the delegation envelope
- [ ] a missing field in peer reports
- [ ] a missing state marker in the corroborator loop
- [ ] a missing trace/receipt artifact
- [ ] a missing memory-routing rule
- [ ] no contract change needed; just an implementation bug

## What counts as a useful outcome
A useful outcome is not just "pass" or "fail".
A useful outcome tells us:
- which pieces of the current process are already enough
- which pieces need a thinner contract
- which pieces need a new peer or feature later
- whether memory is helping the team think and execute better, or just making the room noisier

## Notes for this run
Keep the observation pass honest and narrow:
- success is defined by the spec
- reports should use the current process, not a fantasy contract
- prefer minimum viable contracts
- only add contract fields where the artifacts show a real gap
