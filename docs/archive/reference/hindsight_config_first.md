# Hindsight Configuration Reference

A comprehensive reference for Hindsight memory system configuration in pi-ghosty.

## Table of Contents

- [Status Overview](#status-overview)
- [Current Implementation](#current-implementation)
- [Configuration Options](#configuration-options)
  - [Environment Variables](#environment-variables)
  - [Bank Configuration](#bank-configuration)
  - [Retain Settings](#retain-settings)
  - [Recall Settings](#recall-settings)
  - [Reflect Settings](#reflect-settings)
  - [Observations](#observations)
  - [LLM Configuration](#llm-configuration)
  - [Embeddings & Reranking](#embeddings--reranking)
- [Limitations](#limitations)
- [Tuning Strategies](#tuning-strategies)
- [Next Steps](#next-steps)

---

## Status Overview

**Hindsight** is a biomimetic memory system for AI agents that provides:
- **Retain**: Store memories with automatic fact extraction
- **Recall**: Multi-strategy retrieval (semantic, BM25, graph, temporal)
- **Reflect**: Disposition-aware reasoning over memories

### Current Status in pi-ghosty

| Component | Status | Description |
|-----------|--------|-------------|
| **Integration** | ✅ Active | Memory extension wired into agent lifecycle |
| **Retain** | ✅ Active | Full session transcripts retained post-turn |
| **Recall** | ✅ Active | Injects memories before agent response |
| **Reflect** | ⏳ Not wired | Available but not currently used |
| **Observations** | ✅ Active | Auto-consolidation enabled |

### Architecture

```
pi-ghosty Agent
  │
  ├─ Before Agent Start → Recall memories (max 2048 tokens, mid budget)
  │                         └─ Inject into system prompt
  │
  └─ After Agent End → Retain transcript
                          ├─ document_id: project/agent/session
                          ├─ Tags: project, agent, session
                          └─ observation_scopes: custom (project + agent only)
```

---

## Current Implementation

### Active Configuration (`.env`)

```bash
HINDSIGHT_BASE_URL=http://localhost:8888
HINDSIGHT_BANK_ID=pi-ghosty
```

### Memory Extension Behavior

**Recall** (per turn):
- Query: user prompt
- Budget: `mid` (100–300ms latency)
- Max tokens: 2048
- Tags: `project:<name>`, `agent:<name>` with `any` match
- Types: `observation`, `world`, `experience`
- Async: true (non-blocking)

**Retain** (post-turn):
- Document ID: `<project>/<agent>/<session>`
- Context: "pi-ghosty agent session transcript"
- Tags: `project`, `agent`, `session`
- Observation scopes: `custom` → `[[project], [agent]]`
- Async: true (non-blocking)

### Service Requirements

| Service | Port | Protocol |
|---------|------|----------|
| Hindsight API | 8888 | HTTP |
| vLLM (LLM backend) | 8002 | OpenAI-compatible |

---

## Configuration Options

### Environment Variables

#### Core Service Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `HINDSIGHT_BASE_URL` | `http://localhost:8888` | API endpoint |
| `HINDSIGHT_BANK_ID` | `pi-ghosty` | Memory bank identifier |

#### LLM Backend

| Variable | Default | Description |
|----------|---------|-------------|
| `HINDSIGHT_API_LLM_PROVIDER` | `openai` | Provider: `openai`, `groq`, `ollama`, `llamacpp`, etc. |
| `HINDSIGHT_API_LLM_API_KEY` | — | API key for provider |
| `HINDSIGHT_API_LLM_MODEL` | `gpt-5-mini` | Model name |
| `HINDSIGHT_API_LLM_BASE_URL` | Provider default | Custom endpoint |
| `HINDSIGHT_API_LLM_MAX_CONCURRENT` | `32` | Max concurrent requests |
| `HINDSIGHT_API_LLM_TIMEOUT` | `120` | Request timeout (seconds) |

#### Database

| Variable | Default | Description |
|----------|---------|-------------|
| `HINDSIGHT_API_DATABASE_URL` | `pg0` | PostgreSQL connection (embedded by default) |
| `HINDSIGHT_API_VECTOR_EXTENSION` | `pgvector` | Vector index: `pgvector`, `pgvectorscale`, `vchord` |

---

### Bank Configuration

Configure via API or environment variables. Hierarchy: **Global → Bank Override**.

#### Retain Mission

Steers fact extraction focus:

```bash
export HINDSIGHT_API_RETAIN_MISSION="Focus on technical decisions, architecture choices, and team member expertise. Deprioritize social or personal information."
```

#### Extraction Mode

| Mode | Description |
|------|-------------|
| `concise` (default) | Selective facts, optimal for long-term memory |
| `verbose` | More detail per fact, slower, more tokens |
| `verbatim` | Store chunks as-is with metadata extraction |
| `chunks` | Zero LLM cost, embeddings only |
| `custom` | Full prompt override via `retain_custom_instructions` |

#### Entity Labels

Define controlled vocabulary for classification:

```json
{
  "entity_labels": [
    {
      "key": "memory_type",
      "type": "value",
      "tag": true,
      "values": [
        {"value": "rule", "description": "Concise operating rule"},
        {"value": "procedure", "description": "Step-by-step instruction"}
      ]
    }
  ]
}
```

---

### Retain Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `HINDSIGHT_API_RETAIN_CHUNK_SIZE` | `3000` | Max characters per chunk |
| `HINDSIGHT_API_RETAIN_EXTRACTION_MODE` | `concise` | Extraction mode |
| `HINDSIGHT_API_RETAIN_MAX_CONCURRENT` | `4` | Max concurrent DB phases |
| `HINDSIGHT_API_RETAIN_MAX_COMPLETION_TOKENS` | `64000` | Max tokens for extraction |

#### Custom Instructions (mode: `custom`)

```bash
export HINDSIGHT_API_RETAIN_EXTRACTION_MODE=custom
export HINDSIGHT_API_RETAIN_CUSTOM_INSTRUCTIONS="ONLY extract:
✅ Technical decisions and rationale
✅ Architecture patterns
✅ Performance metrics

DO NOT extract:
❌ Greetings or social conversation
❌ Process chatter"
```

---

### Recall Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `HINDSIGHT_API_RECALL_MAX_CONCURRENT` | `32` | Max concurrent recalls per worker |
| `HINDSIGHT_API_RECALL_CONNECTION_BUDGET` | `4` | Max DB connections per recall |
| `HINDSIGHT_API_RERANKER_MAX_CANDIDATES` | `300` | Max candidates to rerank |
| `HINDSIGHT_API_GRAPH_RETRIEVER` | `link_expansion` | Graph algorithm |

#### Client-Side Recall Options

```typescript
await hindsight.recall(bankId, query, {
  max_tokens: 2048,        // Limit returned context
  budget: "mid",           // low | mid | high
  tags: ["project:pi-ghosty", "agent:coder"],
  tags_match: "any",       // any | all | any_strict | all_strict
  types: ["observation", "world", "experience"],
  include_entities: true,
  include_chunks: false,
  async: true
})
```

---

### Reflect Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `HINDSIGHT_API_REFLECT_MAX_ITERATIONS` | `10` | Max tool call iterations |
| `HINDSIGHT_API_REFLECT_MAX_CONTEXT_TOKENS` | `100000` | Max context tokens |
| `HINDSIGHT_API_REFLECT_WALL_TIMEOUT` | `300` | Wall-clock timeout (seconds) |

#### Disposition Traits (scale 1–5)

| Trait | 1 | 3 (default) | 5 |
|-------|---|-------------|---|
| `skepticism` | Trusting | Balanced | Skeptical |
| `literalism` | Flexible | Balanced | Literal |
| `empathy` | Detached | Balanced | Empathetic |

```bash
export HINDSIGHT_API_DISPOSITION_SKEPTICISM=4
export HINDSIGHT_API_DISPOSITION_LITERALISM=4
export HINDSIGHT_API_DISPOSITION_EMPATHY=2
```

---

### Observations

Observations are auto-consolidated patterns from facts.

| Variable | Default | Description |
|----------|---------|-------------|
| `HINDSIGHT_API_ENABLE_OBSERVATIONS` | `true` | Enable consolidation |
| `HINDSIGHT_API_CONSOLIDATION_LLM_BATCH_SIZE` | `8` | Facts per consolidation call |
| `HINDSIGHT_API_OBSERVATIONS_MISSION` | — | What to synthesize |

#### Observation Scopes

Controls which tag combinations get their own observation pass:

```json
{
  "observation_scopes": {
    "mode": "custom",
    "scopes": [
      ["project:pi-ghosty"],
      ["agent:coder"]
    ]
  }
}
```

**Modes:**
- `combined`: Single pass with all tags (default)
- `per_tag`: One pass per tag independently
- `all_combinations`: All possible subsets (expensive)
- `custom`: Explicit scope list

---

### LLM Configuration

#### Per-Operation LLM Settings

Different operations can use different models:

```bash
# Default LLM (fallback)
export HINDSIGHT_API_LLM_PROVIDER=groq
export HINDSIGHT_API_LLM_API_KEY=gsk_xxxxx
export HINDSIGHT_API_LLM_MODEL=llama-3.3-70b

# Retain (fact extraction - needs strong structured output)
export HINDSIGHT_API_RETAIN_LLM_MODEL=gpt-4o

# Reflect (reasoning - can use faster model)
export HINDSIGHT_API_REFLECT_LLM_PROVIDER=groq
export HINDSIGHT_API_REFLECT_LLM_MODEL=llama-3.1-8b
```

#### Retry Configuration

```bash
# For rate-limited APIs
export HINDSIGHT_API_RETAIN_LLM_MAX_CONCURRENT=3
export HINDSIGHT_API_RETAIN_LLM_MAX_RETRIES=3
export HINDSIGHT_API_RETAIN_LLM_INITIAL_BACKOFF=2.0
export HINDSIGHT_API_RETAIN_LLM_MAX_BACKOFF=120.0
```

#### Local LLM (llamacpp)

```bash
export HINDSIGHT_API_LLM_PROVIDER=llamacpp
export HINDSIGHT_API_LLAMACPP_GPU_LAYERS=-1  # All layers to GPU
export HINDSIGHT_API_LLAMACPP_CONTEXT_SIZE=8192
export HINDSIGHT_API_LLAMACPP_NO_GRAMMAR=false
```

---

### Embeddings & Reranking

#### Embeddings

| Variable | Default | Description |
|----------|---------|-------------|
| `HINDSIGHT_API_EMBEDDINGS_PROVIDER` | `local` | `local`, `tei`, `openai`, `cohere`, `google`, `litellm` |
| `HINDSIGHT_API_EMBEDDINGS_LOCAL_MODEL` | `BAAI/bge-small-en-v1.5` | Local model |
| `HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL` | `text-embedding-3-small` | OpenAI model |

#### Reranker

| Variable | Default | Description |
|----------|---------|-------------|
| `HINDSIGHT_API_RERANKER_PROVIDER` | `local` | `local`, `tei`, `cohere`, `openrouter`, `zeroentropy` |
| `HINDSIGHT_API_RERANKER_LOCAL_MODEL` | `cross-encoder/ms-marco-MiniLM-L-6-v2` | Local model |

---

## Limitations

### Current Implementation Limitations

1. **Reflect Not Wired**
   - Available but not integrated into agent flow
   - Requires explicit manual or scheduled invocation
   - No automatic reflection after retain

2. **Single Bank**
   - v1 uses one bank for all agents
   - Multi-tenant isolation requires tag-based filtering
   - Cross-agent contamination possible with `tags_match: any`

3. **Session Retention Strategy**
   - Full transcript retained per session
   - No selective retention or pruning
   - Token budget grows with session length

4. **Observation Consolidation**
   - Runs asynchronously after retain
   - No explicit trigger for deep reflection
   - Cannot manually inspect/modify observations

5. **Memory Injection**
   - Bounded to 2048 tokens max
   - No prioritization or summarization
   - May miss critical context in long sessions

### Known Issues

| Issue | Impact | Workaround |
|-------|--------|------------|
| Retain + Recall same turn | Retained facts not immediately available | Retain end-of-turn, recall start-of-next-turn |
| No per-agent bank isolation | Cross-agent memory leakage possible | Use `any_strict` tag matching |
| Observation history enabled | Extra storage overhead | Set `HINDSIGHT_API_ENABLE_OBSERVATION_HISTORY=false` |
| Local embeddings (CPU) | Slow on large datasets | Use TEI or cloud provider |

---

## Tuning Strategies

### Performance Tuning

#### Reduce Recall Latency

```bash
# Lower max tokens for faster retrieval
# HINDSIGHT_API_RECALL_MAX_TOKENS=1024

# Use low budget for simple lookups
# recall(query, { budget: "low" })

# Reduce concurrent recalls
# HINDSIGHT_API_RECALL_MAX_CONCURRENT=8
```

#### Optimize Retain Throughput

```bash
# Increase chunk size for fewer LLM calls
# HINDSIGHT_API_RETAIN_CHUNK_SIZE=5000

# Use verbatim mode for zero LLM cost (embeddings only)
# HINDSIGHT_API_RETAIN_EXTRACTION_MODE=verbatim

# Limit concurrent retain phases
# HINDSIGHT_API_RETAIN_MAX_CONCURRENT=2
```

### Memory Quality Tuning

#### Improve Fact Extraction

```bash
# Verbose mode for richer facts
export HINDSIGHT_API_RETAIN_EXTRACTION_MODE=verbose

# Custom instructions for domain-specific extraction
export HINDSIGHT_API_RETAIN_EXTRACTION_MODE=custom
export HINDSIGHT_API_RETAIN_CUSTOM_INSTRUCTIONS="Extract technical decisions, architecture patterns, and performance metrics. Ignore greetings and process chatter."
```

#### Control Observation Synthesis

```bash
# Customize what observations are synthesized
export HINDSIGHT_API_OBSERVATIONS_MISSION="Observations are durable patterns about project architecture and team preferences. Focus on recurring patterns, not one-off events."

# Disable observation history to save storage
export HINDSIGHT_API_ENABLE_OBSERVATION_HISTORY=false
```

#### Tag-Based Filtering

```typescript
// Strict matching prevents cross-agent leakage
recall(query, {
  tags: ["project:pi-ghosty", "agent:coder"],
  tags_match: "any_strict"  // Only memories with BOTH tags
})
```

### Cost Optimization

#### Use Separate Models

```bash
# Strong model for retain (extraction)
export HINDSIGHT_API_RETAIN_LLM_MODEL=gpt-4o
export HINDSIGHT_API_RETAIN_LLM_PROVIDER=openai

# Faster/cheaper model for reflect
export HINDSIGHT_API_REFLECT_LLM_MODEL=gpt-4o-mini
export HINDSIGHT_API_REFLECT_LLM_PROVIDER=groq
```

#### Disable Unused Features

```bash
# Disable observation history
export HINDSIGHT_API_ENABLE_OBSERVATION_HISTORY=false

# Use cheaper embeddings
export HINDSIGHT_API_EMBEDDINGS_PROVIDER=local
export HINDSIGHT_API_EMBEDDINGS_LOCAL_MODEL=BAAI/bge-small-en-v1.5

# Use local reranker
export HINDSIGHT_API_RERANKER_PROVIDER=local
```

---

## Next Steps

### Immediate Priorities

1. **Wire Reflect into Agent Flow**
   - Add reflect call after significant tool usage
   - Inject reflect results into context
   - Measure impact on response quality

2. **Implement Selective Retention**
   - Add memory policy for what to retain
   - Implement token budget limits
   - Add session pruning strategy

3. **Multi-Agent Isolation**
   - Create per-agent banks
   - Implement cross-agent query patterns
   - Add memory peer for management

### Optimization Opportunities

1. **Observation-First Recall**
   - Prioritize observations over raw facts
   - Implement observation-only recall mode
   - Faster, more concise responses

2. **Mental Models**
   - Create mental models for common queries
   - Sub-100ms responses for frequent questions
   - Manual curation for quality control

3. **Background Consolidation**
   - Run reflect as scheduled job
   - Generate summary observations periodically
   - Track behavioral changes over time

### Future Enhancements

1. **Memory Quality Metrics**
   - Track recall precision/recall
   - Measure observation freshness
   - Monitor memory bloat

2. **Multi-Model Strategy**
   - Use different models for different operations
   - A/B test model combinations
   - Dynamic model selection based on query type

3. **Memory Compression**
   - Implement chunk deduplication
   - Add summary layers for long sessions
   - Lazy loading for large banks

---

## Quick Reference

### Common Commands

```bash
# Start Hindsight API (local)
hindsight-embed daemon start

# Create new bank
hindsight bank create my-bank

# Set bank config
hindsight bank set-config my-bank \
  --retain-mission "Focus on technical decisions" \
  --disposition-skepticism 4

# Retain memory
hindsight memory retain my-bank "User prefers TypeScript over JavaScript"

# Recall memories
hindsight memory recall my-bank "user preferences"

# Reflect
hindsight memory reflect my-bank "How should I approach this task?"
```

### Environment Variable Cheat Sheet

```bash
# Core
HINDSIGHT_BASE_URL=http://localhost:8888
HINDSIGHT_BANK_ID=pi-ghosty

# LLM
HINDSIGHT_API_LLM_PROVIDER=groq
HINDSIGHT_API_LLM_API_KEY=gsk_xxxxx
HINDSIGHT_API_LLM_MODEL=llama-3.3-70b

# Retain
HINDSIGHT_API_RETAIN_EXTRACTION_MODE=concise
HINDSIGHT_API_RETAIN_MISSION="Focus on technical decisions"

# Observations
HINDSIGHT_API_ENABLE_OBSERVATIONS=true
HINDSIGHT_API_OBSERVATIONS_MISSION=""

# Disposition
HINDSIGHT_API_DISPOSITION_SKEPTICISM=3
HINDSIGHT_API_DISPOSITION_LITERALISM=3
HINDSIGHT_API_DISPOSITION_EMPATHY=3
```

---

*Last updated: 2026-04-10*
