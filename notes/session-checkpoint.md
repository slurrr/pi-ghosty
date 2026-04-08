# Current Goal
Get prompt/tool-availability ergonomics under control for multi-peer delegation:
- Coordinator must not delegate impossible tasks (must know peer tool surfaces)
- Move “how to use delegate/peer_report” instructions out of always-on system prompt parts and into skills
- Avoid loops where a peer repeatedly calls an unavailable tool (e.g. bash) and wedges the coordinator

# Current State
- Branch: `fuck-around-find-out`.
- Delegate wedge observed: researcher peer repeatedly attempted `bash` and received toolResult `Tool bash not found`, causing coordinator to hang waiting for peer completion.
- A process kill switch exists via pidfile: pi-ghosty writes `~/runs/pi-ghosty/ghosty.pid`; `npm run kill` sends SIGINT.
- Work in progress: skill docs added under `.pi/skills/`:
  - `.pi/skills/delegate/SKILL.md`
  - `.pi/skills/peer-report/SKILL.md`
- Work in progress (controversial): placeholder-based expansion of peer tool surfaces from `pi-agent.json` was started, but placement/approach is disputed.

# Decisions
- Keep `delegate` and `peer_report` as tools.
- Put tool usage instructions in skills (discoverable, invoked on demand), not as always-on coordinator prompt parts.

# Open Problems
- How to expose peer tool surfaces to the coordinator *early enough* to prevent impossible delegations.
  - Skills are static markdown; they cannot auto-expand placeholders from config without custom runtime logic.
- Need a guardrail against “tool not found” loops (fail fast with an instructive error and force `peer_report`).

# Resume Instructions
1. Inspect current diffs: `git status` and decide whether to keep or revert the peer-tool-surface placeholder changes.
2. Decide canonical place for tool-surface truth:
   - either expand into a kept coordinator prompt part (e.g. coordinator role md) via placeholder replacement, or
   - inject via an extension at session start.
3. Add a loop breaker for peers:
   - if toolResult contains `Tool <name> not found`, inject a message: "tool unavailable; do not retry; call peer_report with limitation" and/or abort after N repeats.
4. Test: delegate a task that would normally tempt `bash` for a peer, confirm the peer reports limitation instead of looping.
