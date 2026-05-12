# Peer Prompt Mapping & Analysis

**Status:** Draft  
**Date:** 2026-04-09  
**Scope:** Analysis of peer prompt organization in pi-ghosty

---

## Executive Summary

pi-ghosty uses a **single-model, multi-peer architecture** where each peer is defined by a set of markdown prompt parts assembled in lexicographic order. The current state shows **strong role differentiation** but **inconsistent structure** across peers.

### Key Findings

| Peer | File Count | Strengths | Gaps |
|------|------------|-----------|------|
| **Corroborator** | 6 | Rich persona/identity context, user modeling, operational scaffolding | No explicit tool/skills declaration, inconsistent file purposes |
| **Coder** | 2 | Clear role definition, concise peer-report spec | Missing tool context, no delegation protocol details |
| **Researcher** | 2 | Clear research methodology, data-first approach | No tool context, no peer-report spec (copy-paste from others) |
| **Reviewer** | 2 | Strong QA focus, scope drift detection | No tool context, no peer-report spec (copy-paste) |
| **Memory** | 2 | Purpose-focused, no overreach | Minimal content, no peer-report spec (copy-paste) |

### Overall Assessment

- ✅ **Good:** Role-specific prompts are clear and focused
- ⚠️ **Concern:** Peer-report specs duplicated across 4 peers without customization
- ⚠️ **Concern:** No explicit tool/skills declarations in any peer
- ⚠️ **Concern:** Missing cross-peer communication protocols
- ✅ **Good:** Corroborator has the most comprehensive setup

---

## Peer-by-Peer Analysis

### Corroborator

**Files:**
- `00-role.md` — Core responsibilities and delegation philosophy
- `GHOSTY.md` — Work mode activation and session checkpointing logic
- `IDENTITY.md` — Ghosty's self-definition (placeholder for user customization)
- `memory.md` — Hindsight memory system usage instructions
- `PERSONA.md` — Personality and behavioral guidelines
- `USER.md` — User (Seth) context and preferences

**Strengths:**
- Most comprehensive peer setup in the system
- Clear separation of concerns (role, identity, persona, memory, user)
- Strong operational scaffolding in GHOSTY.md (checkpoint flow, delegation structure)
- User modeling provides context for adaptive behavior

**Gaps:**
- No explicit declaration of available tools or skills
- No reference to the delegation protocol mechanics (peer_tools, session IDs)
- GHOSTY.md is verbose and mixes operational logic with role definition
- No clear boundary between what Corroborator does vs. what peers do

**Recommendations:**
1. Add a `00-tools.md` or `00-capabilities.md` file listing available tools and skills
2. Simplify GHOSTY.md into a separate operational guide (not prompt)
3. Add explicit cross-peer communication patterns (how to call peer_report, when to delegate)
4. Consider consolidating PERSONA.md and USER.md if they overlap

---

### Coder

**Files:**
- `00-role.md` — Core responsibilities and coding philosophy
- `01-peer-report.md` — Output format and reporting requirements

**Strengths:**
- Concise, focused role definition
- Clear coding philosophy (surgical edits, non-destructive changes)
- Peer-report spec is explicit about output format

**Gaps:**
- No tool context (what tools can Coder use?)
- No skills declaration (delegate skill, brave-search, etc.)
- Peer-report spec is generic copy-paste (not peer-specific)
- No reference to the delegation protocol

**Recommendations:**
1. Add a `00-tools.md` listing Coder's tool access (edit, write, read, grep, find, bash, etc.)
2. Customize `01-peer-report.md` to include Coder-specific output expectations
3. Add a brief section on when to use which tool (e.g., "use edit for small changes, write for new files")

---

### Researcher

**Files:**
- `00-role.md` — Core responsibilities and research methodology
- `01-peer-report.md` — Output format and reporting requirements

**Strengths:**
- Clear data-first approach
- Emphasis on extraction and citation
- Shallow-to-deep exploration pattern

**Gaps:**
- No tool context (what tools can Researcher use?)
- No skills declaration
- Peer-report spec is generic copy-paste
- No reference to delegation protocol

**Recommendations:**
1. Add a `00-tools.md` listing Researcher's tool access (brave-search, browser-tools, youtube-transcribe, etc.)
2. Customize `01-peer-report.md` to include Researcher-specific output expectations (sources, citations, confidence levels)
3. Add guidance on when to use which research tool

---

### Reviewer

**Files:**
- `00-role.md` — Core responsibilities and QA focus
- `01-peer-report.md` — Output format and reporting requirements

**Strengths:**
- Strong focus on scope drift and philosophy alignment
- Emphasis on safety and correctness
- Clear rejection criteria

**Gaps:**
- No tool context (what tools can Reviewer use?)
- No skills declaration
- Peer-report spec is generic copy-paste
- No reference to delegation protocol

**Recommendations:**
1. Add a `00-tools.md` listing Reviewer's tool access (read, grep, edit for diff comparison, etc.)
2. Customize `01-peer-report.md` to include Reviewer-specific output (checklist, issues, severity levels)
3. Add guidance on what constitutes a "pass" vs. "fail" review

---

### Memory

**Files:**
- `00-role.md` — Core responsibilities and memory system usage
- `01-peer-report.md` — Output format and reporting requirements

**Strengths:**
- Purpose-focused (no overreach)
- Clear boundary (not the primary retain/recall loop)
- Concise and minimal

**Gaps:**
- No tool context (what tools can Memory use?)
- No skills declaration
- Peer-report spec is generic copy-paste
- No reference to delegation protocol
- Very minimal content (could be expanded)

**Recommendations:**
1. Add a `00-tools.md` listing Memory's tool access (Hindsight API, peer_report, etc.)
2. Customize `01-peer-report.md` to include Memory-specific output (memory quality metrics, recall suggestions)
3. Consider adding a `00-missions.md` or `00-templates.md` for memory mission/bank definitions

---

## Cross-Peer Analysis

### Consistency Issues

| Issue | Affected Peers | Impact |
|-------|----------------|--------|
| Duplicate peer-report.md | Coder, Researcher, Reviewer, Memory | Inconsistent reporting, maintenance overhead |
| No tool declarations | All peers | Unclear capabilities, potential tool misuse |
| No delegation protocol docs | All peers | Unclear how peers interact with Corroborator |
| No skills declarations | All peers | Unclear what specialized skills are available |

### Missing Documentation

1. **Delegation Protocol** — How does a peer receive a delegation? What format?
2. **Tool Access Matrix** — Which tools are available to which peers?
3. **Skills Reference** — What skills exist and how are they invoked?
4. **Peer Communication** — How do peers communicate with each other (if at all)?
5. **Session Management** — How are peer sessions created, resumed, terminated?

---

## Recommendations Summary

### Immediate Actions (v1)

1. **Add tool declarations** to each peer's `00-tools.md`
2. **Customize peer-report.md** for each peer (remove duplication)
3. **Document the delegation protocol** in a shared `docs/decisions/0007-delegation-protocol.md`
4. **Create a tool access matrix** in `docs/reference/tool-access.md`

### Short-term (v2)

1. **Add skills declarations** to each peer
2. **Document peer communication patterns**
3. **Add session management documentation**
4. **Consolidate Corroborator's GHOSTY.md** into operational docs

### Long-term (v3+)

1. **Add cross-peer collaboration patterns**
2. **Document error handling and recovery**
3. **Add peer-specific examples and test cases**
4. **Consider a shared peer base prompt** for common patterns

---

## Implementation Notes

### Prompt Assembly Order

Files are assembled in **lexicographic order** (per `peers/README.md`):
1. `00-*.md` files first (role, tools, identity, etc.)
2. `01-*.md` files next (peer-report, etc.)
3. Additional numbered files follow

**Recommendation:** Stick to the `00-`, `01-`, `02-` naming convention for stable ordering.

### File Size Guidelines

- Keep individual files **small and focused** (per `peers/README.md`)
- Corroborator has the most files (6) but they're each concise
- Consider adding a `00-summary.md` or `00-index.md` to each peer folder if the file count grows

### Shared vs. Peer-Specific Parts

Currently:
- **Shared:** Default system prompt from pi (via `.pi/APPEND_SYSTEM.md`)
- **Peer-specific:** All `peers/<agent>/*.md` files

**Recommendation:** Consider a `peers/shared/*.md` folder for common patterns (e.g., shared peer-report format, common tool declarations).

---

## References

- [peers/README.md](../../peers/README.md) — Prompt assembly rules
- [docs/decisions/0001-single-model-multi-peer.md](../decisions/0001-single-model-multi-peer.md) — Architecture decision
- [docs/decisions/0003-explicit-peer-addressing.md](../decisions/0003-explicit-peer-addressing.md) — Delegation via @prefix
- [docs/decisions/0006-disable-auto-agents-context.md](../decisions/0006-disable-auto-agents-context.md) — Context injection policy
- [docs/decisions/0002-memory-hindsight.md](../decisions/0002-memory-hindsight.md) — Memory subsystem

---

*End of document*
