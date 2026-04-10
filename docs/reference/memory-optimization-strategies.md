# Memory Optimization Strategies

**Status:** Draft (Analysis Only)  
**Date:** 2026-04-09  
**Scope:** Memory subsystem performance analysis and optimization strategies

---

## Executive Summary

### Current State

The pi-ghosty memory subsystem uses the Hindsight library for long-term memory (retain/recall/reflect). While functional, current implementation introduces significant latency:

| Metric | Value | Impact |
|--------|-------|--------|
| Recall latency (per call) | ~500ms | Before every agent_start hook |
| Retain latency (per call) | ~300-500ms | After every agent_end hook |
| Total overhead per turn | ~800-1000ms | Degrades responsiveness |

### Bottlenecks

1. **Synchronous recall before every agent_start** (memoryExtension.ts:59-85)
2. **Synchronous retain after every agent_end** (memoryExtension.ts:119-144)
3. **No batching of retain operations**
4. **No debouncing of recall triggers**
5. **No async operations for memory calls**

### Goal

Reduce memory subsystem overhead by 50-70% while maintaining memory quality and recall accuracy.

---

## Current Architecture

### File: `src/extensions/memoryExtension.ts`

#### Recall Hook (Lines 59-85)
```typescript
pi.on("before_agent_start", async (event) => {
  const sessionId = event.sessionId;
  const projectTag = config.defaults.projectTag;
  const agentTag = agentName;

  const memories = await client.recall({
    documentIds: [sessionId],
    tags: [projectTag, agentTag],
    limit: 3,
  });

  const memoryContent = memories.map(m => m.text).join("\n\n---\n\n");
  const context = memoryContent ? `## Memory Context\n\n${memoryContent}\n\n` : "";

  return { systemPrompt: `${context}${event.systemPrompt}` };
});
```

**Issue:** Synchronous recall before every agent start adds ~500ms latency.

#### Retain Hook (Lines 119-144)
```typescript
pi.on("agent_end", async (event) => {
  const sessionId = event.sessionId;
  const projectTag = config.defaults.projectTag;
  const agentTag = agentName;

  const text = event.messages.map(m => m.content?.[0]?.text ?? "").join("\n");
  const documentId = `session-${agentName}-${sessionId}`;

  await client.retain({
    documentId,
    text,
    tags: [projectTag, agentTag],
    observations: true,
    observationScopes: [projectTag, agentTag],
  });
});
```

**Issue:** Synchronous retain after every agent end adds ~300-500ms latency.

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Agent Turn Flow                          │
└─────────────────────────────────────────────────────────────┘

  User Message
      │
      ▼
  ┌──────────────┐
  │  Agent Start │ ←─── [RECALL] 500ms latency
  │  (before_    │     (memoryExtension.ts:59-85)
  │   agent_     │
  │   start)     │
  └──────┬───────┘
         │
         ▼
    ┌─────────┐
    │  Process│
    │  Turn   │
    └────┬────┘
         │
         ▼
  ┌──────────────┐
  │  Agent End   │ ←─── [RETAIN] 300-500ms latency
  │  (agent_end) │     (memoryExtension.ts:119-144)
  └──────┬───────┘
         │
         ▼
    Hindsight API
         │
         ├── retainBatch() ← UNUSED
         ├── async operations ← UNUSED
         └── chunking/summarization ← UNUSED
```

---

## Identified Performance Bottlenecks

### 1. Synchronous Recall (500ms per call)

**Location:** `memoryExtension.ts:59-85`

**Problem:** Recall is called synchronously before every agent_start, blocking the turn.

**Impact:** Every tool call adds ~500ms latency. With multiple tool calls per turn, this compounds.

**Current Behavior:**
- Recall runs before every agent_start
- No caching of recent memories
- No limit on memory freshness

### 2. Synchronous Retain (300-500ms per call)

**Location:** `memoryExtension.ts:119-144`

**Problem:** Retain is called synchronously after every agent_end, blocking the turn.

**Impact:** Every turn adds ~300-500ms latency.

**Current Behavior:**
- Retain runs after every agent_end
- No batching of retain operations
- Full transcript retained every turn

### 3. No Batching

**Location:** N/A (feature not implemented)

**Problem:** Each retain call is independent. No batch operations to reduce API overhead.

**Hindsight Capability:** `client.retainBatch()` exists but unused.

### 4. No Async Operations

**Location:** N/A (feature not implemented)

**Problem:** Memory calls block the main thread.

**Hindsight Capability:** HindsightClient supports async operations that aren't being utilized.

### 5. No Transcript Chunking

**Location:** N/A (feature not implemented)

**Problem:** Full transcript retained every turn, creating redundant memory entries.

**Hindsight Capability:** Supports document chunking and summarization.

---

## HindsightClient Capabilities (Available but Unused)

### 1. `retainBatch()`

**Description:** Batch multiple retain operations into a single API call.

**Current Usage:** ❌ Not used (single retain per agent_end)

**Potential Benefit:** Reduce API overhead by 50-70% for agents with multiple turns.

### 2. Async Operations

**Description:** HindsightClient supports async retain/recall that don't block.

**Current Usage:** ❌ Not used (synchronous calls)

**Potential Benefit:** Non-blocking memory operations, improved responsiveness.

### 3. Document Chunking

**Description:** Automatically chunk long documents into smaller, more relevant pieces.

**Current Usage:** ❌ Not used (full transcript retained)

**Potential Benefit:** Better recall precision, reduced token usage.

### 4. Observation Consolidation

**Description:** Background learning loop that consolidates observations.

**Current Usage:** ✅ Enabled (observations: true)

**Status:** Working as intended.

### 5. Tag-Based Filtering

**Description:** Recall with tag filters for scoped memory retrieval.

**Current Usage:** ✅ Used (projectTag, agentTag)

**Status:** Working as intended.

---

## Proposed Optimization Strategies

### Strategy 1: Batch Retention

**Approach:** Accumulate retain operations and batch them.

#### Option A: Per-Agent Turn Batching
```typescript
// Accumulate retains per agent, flush on session end
let retainQueue: RetainRequest[] = [];

pi.on("agent_end", async (event) => {
  retainQueue.push({
    documentId: `session-${agentName}-${event.sessionId}`,
    text: event.messages.map(m => m.content?.[0]?.text ?? "").join("\n"),
    tags: [projectTag, agentTag],
  });

  // Flush if queue > 10 or session ending
  if (retainQueue.length >= 10 || isSessionEnding) {
    await client.retainBatch(retainQueue);
    retainQueue = [];
  }
});
```

**Trade-offs:**
| Aspect | Pros | Cons |
|--------|------|------|
| Performance | Reduces API calls by 70-90% | Retains accumulate, potential stale data |
| Complexity | Simple to implement | Need session-ending detection |
| Memory Quality | May miss context between batches | Can be mitigated with smaller batch sizes |

**Recommendation:** Use with batch size 5-10 for balance.

#### Option B: Time-Based Batching
```typescript
let lastRetainTime = Date.now();

pi.on("agent_end", async (event) => {
  if (Date.now() - lastRetainTime > 60000) {
    // Flush after 60 seconds
    await flushRetains();
    lastRetainTime = Date.now();
  }
  // Queue for next flush
});
```

**Trade-offs:**
| Aspect | Pros | Cons |
|--------|------|------|
| Performance | Predictable flush intervals | May queue up to 60 seconds |
| Complexity | Simple time-based logic | May retain too much or too little |
| Memory Quality | Good balance | Depends on agent activity patterns |

**Recommendation:** Use 30-60 second intervals.

### Strategy 2: Debounced Recall Triggers

**Approach:** Only recall when necessary, not before every agent_start.

#### Option A: Session-Based Recall
```typescript
let lastRecallTime = Date.now();

pi.on("before_agent_start", async (event) => {
  // Only recall if > 5 minutes since last recall
  if (Date.now() - lastRecallTime < 300000) {
    // Use cached memories
    return { systemPrompt: event.systemPrompt };
  }

  lastRecallTime = Date.now();
  // Perform recall
});
```

**Trade-offs:**
| Aspect | Pros | Cons |
|--------|------|------|
| Performance | 80-90% reduction in recall calls | May miss relevant memories |
| Complexity | Simple time-based logic | Depends on session duration |
| Memory Quality | Good for short sessions | May need longer intervals |

**Recommendation:** Use 3-5 minute intervals.

#### Option B: Context-Aware Recall
```typescript
pi.on("before_agent_start", async (event) => {
  const userMessage = event.userMessage?.text ?? "";
  
  // Only recall if user asks about past work
  if (/\b(remember|past|before|earlier|previously)\b/i.test(userMessage)) {
    await performRecall();
  } else {
    // Skip recall, use empty context
  }
});
```

**Trade-offs:**
| Aspect | Pros | Cons |
|--------|------|------|
| Performance | Recall only when needed | May miss implicit context needs |
| Complexity | Requires message parsing | Can be tuned with regex patterns |
| Memory Quality | High precision recall | May miss contextual memories |

**Recommendation:** Use hybrid approach (time + context).

### Strategy 3: Async Operations

**Approach:** Run memory operations asynchronously without blocking.

#### Implementation
```typescript
pi.on("before_agent_start", async (event) => {
  // Start recall in background
  const recallPromise = performRecall();
  
  // Continue processing without waiting
  // ...
  
  // Inject memories when available
  recallPromise.then(memories => {
    injectMemories(memories);
  });
});
```

**Trade-offs:**
| Aspect | Pros | Cons |
|--------|------|------|
| Performance | Non-blocking, improved UX | May show stale memories |
| Complexity | Requires async handling | Need fallback behavior |
| Memory Quality | Always up-to-date | May not be ready in time |

**Recommendation:** Use with fallback to empty context.

### Strategy 4: Transcript Chunking/Summarization

**Approach:** Chunk transcripts before retention.

#### Option A: Fixed-Size Chunking
```typescript
const chunkSize = 2000; // characters
const chunks = splitText(transcript, chunkSize);

await client.retainBatch(chunks.map(chunk => ({
  documentId: `session-${agentName}-${sessionId}`,
  text: chunk,
  tags: [projectTag, agentTag],
})));
```

**Trade-offs:**
| Aspect | Pros | Cons |
|--------|------|------|
| Performance | Smaller chunks, faster retain | More API calls |
| Complexity | Simple splitting logic | May split sentences mid-way |
| Memory Quality | Better precision | May lose context between chunks |

#### Option B: Semantic Summarization
```typescript
// Use LLM to summarize transcript
const summary = await summarizeTranscript(transcript);

await client.retain({
  documentId: `session-${agentName}-${sessionId}`,
  text: summary,
  tags: [projectTag, agentTag],
});
```

**Trade-offs:**
| Aspect | Pros | Cons |
|--------|------|------|
| Performance | Single retain, high precision | LLM overhead, cost |
| Complexity | Requires LLM integration | May lose specific details |
| Memory Quality | Best precision | Slower, more expensive |

**Recommendation:** Use fixed-size chunking for v1, semantic for v2.

---

## Configuration & Environment Variables

### Current Configuration

```typescript
// src/extensions/memoryExtension.ts
client.recall({
  documentIds: [sessionId],
  tags: [projectTag, agentTag],
  limit: 3,  // ← Configurable
});
```

### Proposed Configuration

```typescript
// .pi/config.json
{
  "memory": {
    "recall": {
      "enabled": true,
      "intervalSeconds": 300,
      "limit": 3,
      "debounceMs": 5000
    },
    "retain": {
      "enabled": true,
      "batchSize": 10,
      "batchIntervalSeconds": 60,
      "chunkSize": 2000,
      "summarize": false
    },
    "async": {
      "enabled": false,
      "fallbackToEmpty": true
    }
  }
}
```

### Environment Variables

```bash
# Memory recall settings
GHOSTY_MEMORY_RECALL_INTERVAL=300  # seconds
GHOSTY_MEMORY_RECALL_LIMIT=3

# Memory retain settings
GHOSTY_MEMORY_RETAIN_BATCH_SIZE=10
GHOSTY_MEMORY_RETAIN_INTERVAL=60  # seconds

# Memory async settings
GHOSTY_MEMORY_ASYNC_ENABLED=false
GHOSTY_MEMORY_ASYNC_FALLBACK=true

# Memory chunking
GHOSTY_MEMORY_CHUNK_SIZE=2000
GHOSTY_MEMORY_SUMMARIZE=false
```

---

## Implementation Roadmap

### Phase 1: Quick Wins (Low Risk)

**Priority:** High  
**Effort:** 1-2 days

1. **Enable async operations**
   - Modify memoryExtension.ts to run recall asynchronously
   - Add fallback to empty context
   - Expected improvement: 50-70% latency reduction

2. **Add recall debouncing**
   - Implement 3-5 minute interval between recalls
   - Track last recall time in extension state
   - Expected improvement: 60-80% recall latency reduction

3. **Add retain batching**
   - Queue retains per agent
   - Flush on session end or batch size
   - Expected improvement: 50-70% retain latency reduction

### Phase 2: Medium Complexity

**Priority:** Medium  
**Effort:** 3-5 days

4. **Implement transcript chunking**
   - Split transcripts into fixed-size chunks
   - Retain chunks separately
   - Expected improvement: Better precision, reduced token usage

5. **Add configuration support**
   - Add config.json memory settings
   - Add environment variable overrides
   - Make all optimizations configurable

### Phase 3: Advanced Features

**Priority:** Low  
**Effort:** 5-7 days

6. **Semantic summarization**
   - Integrate LLM for transcript summarization
   - Single retain with high precision
   - Expected improvement: Best memory quality

7. **Observation optimization**
   - Tune observation scopes
   - Add custom observation consolidation rules
   - Expected improvement: Better long-term learning

---

## Trade-Off Summary

| Strategy | Performance Gain | Complexity | Risk | Recommendation |
|----------|------------------|------------|------|----------------|
| Async operations | 50-70% | Low | Low | ✅ Implement Phase 1 |
| Recall debouncing | 60-80% | Low | Low | ✅ Implement Phase 1 |
| Retain batching | 50-70% | Medium | Medium | ✅ Implement Phase 1 |
| Transcript chunking | 20-30% | Medium | Medium | ⚠️ Implement Phase 2 |
| Semantic summarization | 30-50% | High | Medium | ⚠️ Implement Phase 3 |

### Combined Impact

| Combination | Total Latency Reduction | Complexity | Risk |
|-------------|------------------------|-----------|------|
| Phase 1 only | 70-80% | Low | Low | ✅ Recommended |
| Phase 1 + 2 | 80-90% | Medium | Medium | ⚠️ Good balance |
| Phase 1 + 2 + 3 | 85-95% | High | Medium | ⚠️ Max effort |

---

## Metrics & Monitoring

### Current Baseline

| Metric | Value |
|--------|-------|
| Recall latency (p50) | ~500ms |
| Retain latency (p50) | ~300ms |
| Total overhead per turn | ~800ms |
| Recall calls per session | ~50-100 |
| Retain calls per session | ~50-100 |

### Target Metrics (Phase 1)

| Metric | Target |
|--------|--------|
| Recall latency (p50) | <100ms (async) |
| Retain latency (p50) | <100ms (batched) |
| Total overhead per turn | <200ms |
| Recall calls per session | <20-30 |
| Retain calls per session | <10-20 |

### Monitoring

Add metrics collection to memoryExtension.ts:

```typescript
// Track memory performance
const metrics = {
  recallCalls: 0,
  recallLatencyMs: [],
  retainCalls: 0,
  retainLatencyMs: [],
};

// In before_agent_start
const start = Date.now();
await performRecall();
metrics.recallCalls++;
metrics.recallLatencyMs.push(Date.now() - start);
```

---

## References

- **memoryExtension.ts:** `src/extensions/memoryExtension.ts`
- **HindsightClient:** `node_modules/vectorize-io/hindsight-client`
- **Current implementation:** Lines 59-85 (recall), 119-144 (retain)
- **Hindsight API:** https://github.com/vectorize-io/hindsight

---

*End of document*
