# Hindsight Session Memory Optimization Reference

A guide to optimizing session memory usage and performance in pi-ghosty using Hindsight capabilities.

## Table of Contents

- [Current Memory Problems](#current-memory-problems)
- [Optimization Strategies](#optimization-strategies)
- [Hindsight Capabilities to Leverage](#hindsight-capabilities-to-leverage)
- [Priority Implementation Steps](#priority-implementation-steps)
- [Configuration Reference](#configuration-reference)

---

## Current Memory Problems

### 1. Full Transcript Retention

**Problem:** Every agent turn retains the complete conversation transcript via `messagesToTranscript()`, which joins ALL messages into a single document.

**Impact:**
- Token usage grows linearly with session length
- Each retain operation processes the entire history
- No selective retention of valuable information

**Current Code:**
```typescript
// src/extensions/memoryExtension.ts
function messagesToTranscript(messages: AgentMessage[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    // ... joins ALL messages
    lines.push(`User: ${m.content}`);
    // ...
  }
  return lines.join("\n");
}
```

### 2. No Transcript Chunking

**Problem:** No chunking or summarization before retain.

**Impact:**
- Large documents overwhelm extraction LLM
- Slower processing times
- Higher token costs

### 3. No Retain Batching

**Problem:** One retain call per `agent_end` event.

**Impact:**
- 100+ retain calls per hour in active sessions
- No I/O optimization
- Missed batch API cost savings

### 4. No Recall Debouncing

**Problem:** Recall runs before every `agent_start`.

**Impact:**
- Unnecessary recalls for simple queries
- Increased latency
- Memory bandwidth waste

### 5. Observations Accumulate

**Problem:** Observations enabled per retain, creating durable learnings that accumulate.

**Impact:**
- Memory bloat over time
- Observation consolidation runs on every retain
- No TTL or pruning of old observations

### 6. No Size Limits

**Problem:** No token budget limits or retention policies in config.

**Impact:**
- Unbounded document growth
- No automatic cleanup
- Memory exhaustion risk

### 7. Limited Pruning

**Problem:** Only pi's built-in compaction (`retireAfterCompactions=5`).

**Impact:**
- Sessions retained for 5+ compactions
- No session-level pruning
- Cold data still in hot storage

---

## Optimization Strategies

### 1. Retain Batching

**Goal:** Accumulate 5-10 retains before flushing.

**Implementation:**
```typescript
// Accumulate retains in memory
const retainQueue: RetainItem[] = [];

// Add to queue
retainQueue.push({ content, document_id, context, tags });

// Flush when threshold reached
if (retainQueue.length >= 10) {
  await hindsight.retainBatch(bankId, retainQueue);
  retainQueue.length = 0;
}
```

**Benefits:**
- 50%+ reduction in retain calls
- Lower I/O contention
- Enables batch API cost savings

### 2. Recall Debouncing

**Goal:** Debounce recall to 3-5 minute intervals.

**Implementation:**
```typescript
let lastRecallMs = 0;
const DEBOUNCE_MS = 5 * 60 * 1000; // 5 minutes

async function maybeRecall(query: string) {
  const now = Date.now();
  if (now - lastRecallMs < DEBOUNCE_MS) {
    return undefined; // Skip recall
  }
  lastRecallMs = now;
  return await recall(query);
}
```

**Benefits:**
- Reduces recall calls by 60-80%
- Faster response times
- Less memory bandwidth

### 3. Transcript Chunking

**Goal:** Split transcripts into 2000-character chunks.

**Implementation:**
```typescript
function chunkTranscript(transcript: string, chunkSize: number = 2000): string[] {
  const chunks: string[] = [];
  const lines = transcript.split('\n');
  let currentChunk = '';
  
  for (const line of lines) {
    if ((currentChunk + line).length > chunkSize) {
      chunks.push(currentChunk.trim());
      currentChunk = line;
    } else {
      currentChunk += line;
    }
  }
  
  if (currentChunk.trim()) {
    chunks.push(currentChunk);
  }
  
  return chunks;
}
```

**Benefits:**
- Faster extraction
- Better fact quality
- Parallel processing possible

### 4. Semantic Summarization

**Goal:** Create single summary per session.

**Implementation:**
```typescript
// After session ends, generate summary
const summary = await hindsight.reflect(
  bankId,
  "Summarize key technical decisions, preferences, and learnings from this session",
  {
    response_schema: {
      type: "object",
      properties: {
        technical_decisions: { type: "array" },
        preferences: { type: "array" },
        learnings: { type: "array" }
      }
    }
  }
);
```

**Benefits:**
- Compact representation
- Preserves key information
- Reduces document size by 80-90%

### 5. TTL-Based Pruning

**Goal:** Delete old sessions automatically.

**Implementation:**
```typescript
// Periodic cleanup job
async function pruneOldSessions() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30); // 30 days
  
  const oldSessions = await findSessionsBefore(cutoff);
  for (const session of oldSessions) {
    await deleteSession(session.id);
  }
}
```

**Benefits:**
- Automatic cleanup
- Predictable storage usage
- Removes stale data

### 6. Token Budget Limits

**Goal:** Enforce max tokens per document.

**Implementation:**
```typescript
const MAX_DOCUMENT_TOKENS = 32000;

function truncateTranscript(transcript: string): string {
  const tokens = estimateTokens(transcript);
  if (tokens > MAX_DOCUMENT_TOKENS) {
    return truncateToTokens(transcript, MAX_DOCUMENT_TOKENS);
  }
  return transcript;
}
```

**Benefits:**
- Prevents oversized documents
- Predictable token usage
- Faster processing

### 7. Selective Retention

**Goal:** Skip greetings and process chatter.

**Implementation:**
```typescript
function shouldRetainMessage(message: AgentMessage): boolean {
  const content = message.content;
  
  // Skip greetings
  if (/^hi|hello|hey|greetings/i.test(content)) {
    return false;
  }
  
  // Skip process chatter
  if (/^let me check|one moment|checking|looking up/i.test(content)) {
    return false;
  }
  
  // Only retain tool calls and substantive responses
  return message.role === 'assistant' && 
         (message.toolName || message.content.length > 50);
}
```

**Benefits:**
- 40-60% reduction in retain size
- Higher signal-to-noise ratio
- Better observation quality

### 8. Observation-First Recall

**Goal:** Prioritize observations over raw facts.

**Implementation:**
```typescript
const results = await recall(query, {
  types: ["observation"], // Only observations first
  budget: "low",          // Faster
  max_tokens: 1024        // Smaller context
});

if (results.length < 5) {
  // Fall back to all types if observations insufficient
  const allResults = await recall(query, {
    types: ["observation", "world", "experience"],
    budget: "mid"
  });
}
```

**Benefits:**
- Faster recall (observations are pre-consolidated)
- More concise responses
- Better relevance

### 9. Delta Retain

**Goal:** Skip unchanged chunks.

**Implementation:**
```typescript
// Track document state
const documentState = new Map<string, string>();

async function deltaRetain(documentId: string, content: string) {
  const previous = documentState.get(documentId) || '';
  
  if (previous === content) {
    return; // No change, skip retain
  }
  
  // Only retain differences
  const diff = computeDiff(previous, content);
  await retain(diff);
  
  documentState.set(documentId, content);
}
```

**Benefits:**
- Reduces retain calls when no changes
- Lower I/O
- Faster processing

### 10. Session Archival

**Goal:** Move cold sessions to archive.

**Implementation:**
```typescript
async function archiveSession(sessionId: string) {
  const session = await getSession(sessionId);
  
  // Move to cold storage
  await moveToColdStorage(session);
  
  // Update tag
  await addTag(sessionId, `archived:${Date.now()}`);
}
```

**Benefits:**
- Separates hot/cold data
- Cost reduction
- Maintains accessibility

### 11. Tag-Based Retention Policies

**Goal:** Retain only high-value tags.

**Implementation:**
```typescript
const HIGH_VALUE_TAGS = ['project:pi-ghosty', 'agent:coder', 'agent:researcher'];

function shouldRetainTags(tags: string[]): boolean {
  return tags.some(tag => HIGH_VALUE_TAGS.includes(tag));
}
```

**Benefits:**
- Focuses on important data
- Reduces noise
- Better recall quality

### 12. Reflection-Based Pruning

**Goal:** Use reflect to identify redundant memories.

**Implementation:**
```typescript
async function pruneRedundantMemories() {
  const query = "List all memories that are redundant or outdated";
  const results = await reflect(query, {
    response_schema: {
      type: "array",
      items: { type: "string" }
    }
  });
  
  const redundantIds = results.map(r => r.id);
  await deleteMemories(redundantIds);
}
```

**Benefits:**
- AI-driven cleanup
- Preserves important memories
- Maintains memory quality

---

## Hindsight Capabilities to Leverage

### Core Operations

| Capability | Use Case | Benefit |
|------------|----------|---------|
| `retainBatch()` | Batch multiple retains | 50%+ fewer API calls |
| `async: true` | Non-blocking operations | Better throughput |
| `chunking` | Split large documents | Faster extraction |
| `observation consolidation` | Auto-summarize patterns | Durable knowledge |

### Configuration Options

#### Retain Settings

| Setting | Value | Benefit |
|---------|-------|---------|
| `retain_extraction_mode` | `concise` | Optimal for long-term memory |
| `retain_chunk_size` | `2000` | Faster extraction |
| `retain_max_concurrent` | `4` | Limits I/O contention |

#### Extraction Modes

| Mode | Use Case |
|------|----------|
| `concise` | Default, selective facts |
| `verbose` | Richer detail per fact |
| `verbatim` | Store chunks as-is |
| `chunks` | Zero LLM cost, embeddings only |
| `custom` | Full prompt override |

#### Observation Scopes

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

**Benefits:**
- Custom scope filtering
- Prevents cross-agent contamination
- Enables targeted consolidation

### LLM Providers

| Provider | Use Case |
|----------|----------|
| `groq` | Fast, cost-effective inference |
| `ollama` | Local, no API key |
| `llamacpp` | Built-in local inference |
| `openai` | High-quality extraction |

**Per-Operation Overrides:**
```bash
# Different model for retain vs reflect
export HINDSIGHT_API_RETAIN_LLM_MODEL=gpt-4o
export HINDSIGHT_API_REFLECT_LLM_MODEL=gpt-4o-mini
```

### Embeddings & Reranking

| Setting | Recommendation |
|---------|----------------|
| `embeddings_provider` | `local` (BAAI/bge-small-en-v1.5) |
| `reranker_provider` | `local` (cross-encoder/ms-marco-MiniLM-L-6-v2) |

**Benefits:**
- Lower costs
- Faster inference
- No external dependencies

---

## Priority Implementation Steps

### Phase 1: Immediate Wins (Week 1)

**1. Enable Retain Batching**
- [ ] Implement `retainQueue` accumulator
- [ ] Flush when threshold reached (5-10 items)
- [ ] Enable `async: true` for non-blocking
- [ ] Measure reduce in retain calls

**2. Add Recall Debouncing**
- [ ] Implement 5-minute debounce window
- [ ] Track `lastRecallMs` timestamp
- [ ] Skip recall if within window
- [ ] Measure reduction in recall calls

**3. Enable Observation-First Recall**
- [ ] Change recall to `types: ["observation"]`
- [ ] Add fallback to full types if needed
- [ ] Measure latency improvement

### Phase 2: Medium-Term (Week 2-3)

**4. Implement Transcript Chunking**
- [ ] Split transcripts into 2000-char chunks
- [ ] Retain chunks individually with same `document_id`
- [ ] Enable delta retain for unchanged chunks
- [ ] Measure extraction speed improvement

**5. Add Token Budget Limits**
- [ ] Implement `MAX_DOCUMENT_TOKENS = 32000`
- [ ] Truncate transcripts before retain
- [ ] Add token estimation function
- [ ] Monitor document sizes

### Phase 3: Advanced (Week 4+)

**6. Implement Selective Retention**
- [ ] Filter out greetings and process chatter
- [ ] Only retain substantive content
- [ ] Add message-level retention policy
- [ ] Measure size reduction

**7. Add Semantic Summarization**
- [ ] Generate session summary at end
- [ ] Store summary with session
- [ ] Use summary for quick context
- [ ] Measure token savings

**8. Implement TTL Pruning**
- [ ] Add 30-day TTL for sessions
- [ ] Archive old sessions to cold storage
- [ ] Add cleanup job
- [ ] Monitor storage usage

### Phase 4: Optimization (Ongoing)

**9. Reflection-Based Pruning**
- [ ] Run periodic reflect to identify redundancies
- [ ] Delete identified redundant memories
- [ ] Maintain memory quality
- [ ] Monitor memory bloat

**10. Tag-Based Policies**
- [ ] Define high-value tags
- [ ] Implement tag-based retention
- [ ] Archive low-value data
- [ ] Optimize recall quality

---

## Configuration Reference

### Environment Variables

```bash
# Core
HINDSIGHT_BASE_URL=http://localhost:8888
HINDSIGHT_BANK_ID=pi-ghosty

# Retain Settings
HINDSIGHT_API_RETAIN_CHUNK_SIZE=2000
HINDSIGHT_API_RETAIN_EXTRACTION_MODE=concise
HINDSIGHT_API_RETAIN_MAX_CONCURRENT=4

# Observations
HINDSIGHT_API_ENABLE_OBSERVATIONS=true
HINDSIGHT_API_OBSERVATIONS_MISSION="Focus on technical decisions and preferences"

# LLM
HINDSIGHT_API_LLM_PROVIDER=groq
HINDSIGHT_API_LLM_API_KEY=gsk_xxxxx
HINDSIGHT_API_LLM_MODEL=llama-3.3-70b

# Per-Operation
HINDSIGHT_API_RETAIN_LLM_MODEL=gpt-4o
HINDSIGHT_API_REFLECT_LLM_MODEL=gpt-4o-mini
```

### TypeScript Usage

```typescript
import { HindsightClient } from "@vectorize-io/hindsight-client";

const hindsight = createHindsightClient({
  baseUrl: env.HINDSIGHT_BASE_URL,
  bankId: env.HINDSIGHT_BANK_ID
});

// Retain with batching
async function retainBatched(items: RetainItem[]) {
  const queue: RetainItem[] = [];
  
  items.forEach(item => {
    queue.push(item);
    if (queue.length >= 10) {
      await hindsight.retainBatch(bankId, queue, {
        async: true
      });
      queue.length = 0;
    }
  });
  
  // Flush remaining
  if (queue.length > 0) {
    await hindsight.retainBatch(bankId, queue, {
      async: true
    });
  }
}

// Recall with debouncing
let lastRecallMs = 0;
const DEBOUNCE_MS = 5 * 60 * 1000;

async function recallDebounced(query: string) {
  const now = Date.now();
  if (now - lastRecallMs < DEBOUNCE_MS) {
    return undefined;
  }
  lastRecallMs = now;
  
  return await hindsight.recall(bankId, query, {
    max_tokens: 1024,
    budget: "low",
    types: ["observation"],
    async: true
  });
}
```

---

## Metrics to Track

### Performance Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Retain calls/hour | < 10 | Count per hour |
| Recall calls/hour | < 5 | Count per hour |
| Average retain latency | < 500ms | P95 latency |
| Average recall latency | < 200ms | P95 latency |

### Memory Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Average document size | < 16KB | Mean document size |
| Observation count | < 1000 | Count per bank |
| Memory bloat rate | < 1%/day | Growth rate |
| Token usage/session | < 5000 | Tokens per session |

### Quality Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Recall precision | > 80% | Relevant / Total |
| Observation freshness | > 90% | Recent observations |
| Redundancy rate | < 10% | Duplicate memories |

---

*Last updated: 2026-04-10*

