# Gemini Model Thresholds & Cost Analysis

This document tracks the context and cost thresholds for Gemini models used in the `pi-ghosty` Agent OS.

## Gemini 1.5 Flash (The "Worker Bee")
- **Context Ceiling**: 1.0M tokens.
- **Cost Threshold (Input)**:
  - Prompts < 128k: $0.075 / 1M tokens.
  - Prompts > 128k: $0.15 / 1M tokens (Price doubles).
- **Cost Threshold (Output)**: $0.30 / 1M tokens.
- **Best For**: Researcher, Assistant, Document Scanning, Morning Briefings.

## Gemini 2.0 Flash (Experimental)
- **Context Ceiling**: 1.0M tokens.
- **Cost**: Same as 1.5 Flash (often free/limited in preview).
- **Thinking Support**: Yes (Internal thought block).
- **Best For**: Speed-sensitive tasks where drift is acceptable.

## Gemini 2.5 Flash (The "Sweet Spot")
- **Context Ceiling**: 1.0M tokens.
- **Cost**: ~$0.10 / 1M tokens.
- **Thinking Support**: Yes (Native thought block).
- **Best For**: Corroborator (Budget), Reviewer. Highly stable.

## Gemini 3.0 Flash Preview (The "Master Planner")
- **Context Ceiling**: 1.0M tokens.
- **Cost**:
  - Input: $0.50 / 1M tokens.
  - Output (inc. thinking): $3.00 / 1M tokens.
- **Thinking Support**: Yes (Native frontier reasoning).
- **Best For**: Corroborator (Default). Best at tool-call precision and planning.

## Gemini 3.1 Pro Preview (The "Architect")
- **Context Ceiling**: 2.0M tokens.
- **Cost**:
  - Input: $1.25 (<=200k) / $2.50 (>200k) / 1M tokens.
  - Output: $10.00 (<=200k) / $15.00 (>200k) / 1M tokens.
- **Thinking Support**: Yes (Frontier reasoning).
- **Best For**: Hard architectural blocks, complex refactors.

---

## Strategy Notes
- **Threshold Awareness**: The Corroborator should monitor prompt size. When approaching 128k, consider compactions or delegating to fresh peer sessions to reset the cost threshold.
- **Thinking Logic**: Gemini 2.0+ models support thinking tokens natively. If the TUI does not show the toggle, it may require `enable_thinking: true` in the `extra_body` of the request.
