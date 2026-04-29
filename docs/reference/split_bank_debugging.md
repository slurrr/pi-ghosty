---
title: "Mission Framework Design"
source: "https://chatgpt.com/c/69eb9373-5960-83e8-abc8-1d7f964983d0"
author:
published:
created: 2026-04-29
description: "ChatGPT conversation with 6 messages"
tags:
  - "clippings"
---
1. Fix the clearly broken request shape first.  
	Your server is explicitly ignoring `async` and `update_mode` on the retain calls in both banks. Until that warning is gone, ignore every conclusion from append-vs-replace tests. Your logs show that exact warning for both procedural and personal retain calls.  
	In the HTTP API, `async` is top-level on `POST /banks/{bank_id}/memories`, while `update_mode` is item-level inside `items[]`. `append` only works when `document_id` is present. [Hindsight+2Hindsight+2](https://hindsight.vectorize.io/api-reference)

Golden shape to compare against:

```
{  "async": true,  "items": [    {      "content": "only the new delta if using append",      "document_id": "project:pi-ghosty/coordinator/...",      "update_mode": "append",      "tags": ["project:pi-ghosty", "agent:coordinator"]    }  ]}
```
2. Log the exact client payload before send.  
	Do not log your high-level object. Log the final serialized JSON body and request URL at the transport layer. For each retain call, capture:
- URL
- method
- headers
- final JSON body
- bank\_id
- resolved document\_id
- mission/config snapshot used for that bank

What to look for:

- `async` accidentally nested under item or options object
- `update_mode` accidentally top-level
- camelCase vs snake\_case mismatch
- client wrapper silently dropping unknown fields
- same `document_id` reused when you did not mean to
- same exact `content` sent to both banks when you thought one was filtered
3. Verify resolved bank config from the server before every test.  
	Do a `GET /v1/default/banks/{bank_id}/config` immediately before retain and dump the resolved config for both banks. Bank config is managed via the separate config API, not the bank create/update identity calls. That endpoint is the source of truth for whether `retain_mission`, `retain_extraction_mode`, `observations_mission`, and `enable_observations` are actually different per bank. [Hindsight+1](https://hindsight.vectorize.io/developer/api/memory-banks)

Minimum diff to inspect:

- `retain_mission`
- `retain_extraction_mode`
- `observations_mission`
- `enable_observations`
- any retained custom instructions
- chunk size if changed
4. Separate retain debugging from observation debugging.  
	Your logs already show the duplication symptom starting at retain, not just at consolidation: both banks extracted the same counts from the same payloads, first `9 facts` vs `9 facts`, then `16 facts` vs `16 facts`. The higher `18/19/32/33 actions` numbers happen later during consolidation.  
	Observations are a separate post-retain process, and the docs state they run automatically after retain when enabled. [Hindsight+1](https://hindsight.vectorize.io/developer/api/operations)

So the sequence should be:

- disable observations temporarily
- run one retain into each bank
- inspect raw facts only
- only after retain separation is working, re-enable observations
5. Run a minimal bank-isolation test with a payload that should be obviously personal.  
	Do not use a mixed coordinator transcript first. Use a tiny input that should force a personal extraction win.

Example:

```
Seth prefers concise, technical, system-style answers.Seth dislikes generic advice and wants exact commands.Today I changed a retry timeout from 5s to 10s in worker polling.
```

Expected:

- personal bank should strongly favor the first two
- procedural bank may keep the timeout fact, maybe the style fact if missions are too weak
- if both banks still keep all three almost verbatim, your effective config is not actually separating extraction
6. Then run the inverse test with a purely procedural payload.
```
The worker claimed one batch_retain task.We changed update_mode from replace to append for incremental transcript ingestion.Delta retain skipped unchanged chunks.
```

Expected:

- procedural bank keeps most or all
- personal bank should be sparse or empty
- if personal still fills up with these, mission steering is not taking effect enough
7. Confirm append semantics with a true append test.  
	Docs say `append` concatenates onto the existing document text, requires `document_id`, and is meant for incremental growth where you send only the new content. [Hindsight](https://hindsight.vectorize.io/developer/api/retain)  
	So the correct test is:
- first retain: initial content, same `document_id`
- second retain: only new delta, same `document_id`, `update_mode: "append"`
- inspect server log for delta behavior and lower extraction scope

Do not send full history again when testing append. That muddies the result.

8. Check whether you are accidentally testing “same input, same doc id, same tags, same everything.”  
	Your logs show the same logical document path in both banks: `project:pi-ghosty/coordinator/50687938-...`, and both runs fall back to full retain on that document.  
	That is fine mechanically because banks are separate, but it means mission text is doing all the separation work. For debugging, reduce variables:
- keep same content, different banks
- same content, different document\_ids
- different filtered content, different banks
- compare results

That tells you whether the problem is config, payload, or mission sensitivity.

9. Inspect wrapper casing separately for config calls vs retain calls.  
	The docs show Node config examples using camelCase like `retainMission` / `retainExtractionMode`, while the HTTP config API shows snake\_case in the `updates` object. Retain HTTP examples use `async` top-level and `update_mode` item-level. If your client wrapper mixes those conventions incorrectly, fields can vanish silently before they hit the server. [Hindsight+3Hindsight+3Hindsight+3](https://hindsight.vectorize.io/developer/api/memory-banks)
10. Add one temporary “effective config” line to your own agent logs.  
	Before every retain, print:
```
bank=...retain_extraction_mode=...retain_mission_hash=...observations_enabled=...observations_mission_hash=...document_id=...update_mode=...content_len=...content_sha1=...
```

This catches:

- wrong bank config loaded
- same mission accidentally applied to both banks
- same content sent when you expected filtered content
- missing update\_mode before the request even leaves the client
11. Stabilize with one variable change at a time.  
	Recommended order:
- request shape
- config resolution
- observations off
- minimal test payloads
- append semantics
- only then larger real transcripts
12. Pass/fail criteria.  
	Call it stable when:
- no more “Unknown parameters ignored” warnings in server logs
- `GET /config` shows different resolved missions per bank [Hindsight+1](https://hindsight.vectorize.io/api-reference)
- personal-only test retains personal facts in personal bank
- procedural-only test retains little or nothing in personal bank
- observations off still shows bank separation at raw fact level
- append test changes delta behavior in a way consistent with docs [Hindsight](https://hindsight.vectorize.io/developer/api/retain)

If you want a compact operator script next, use this exact sequence:

1. dump `GET /config` for both banks
2. send one tiny personal payload sync, observations off
3. list raw memories for both banks
4. send one tiny procedural payload sync, observations off
5. list raw memories again
6. fix transport until warnings disappear
7. re-enable observations
8. rerun with real coordinator transcript

The highest-probability issue remains transport shape, not mission quality. Your single-bank test already proved the mission approach can work.