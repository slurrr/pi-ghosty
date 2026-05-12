# Delegation postmortem: async handoff, visibility lag, and peer overruns

This is a postmortem for the delegation work that looked broken while it was running.
The main lesson is simple and annoying as hell
**non-blocking delegation** is the right default, but it only works if the corroborator treats peer results as eventually consistent and never assumes the answer will arrive inside the same turn.

## What the user asked for

The intended behavior was:

- launch peer work without blocking the corroborator,
- keep the corroborator free to continue doing other work,
- persist the peer response durably,
- surface the peer response back into the corroborator session eventually and visibly,
- and stop the peer once the useful result was already produced.

One important correction
this was never a request for same-turn blocking or same-turn certainty. the point was to keep moving, not to sit on our hands waiting for a worker to come back.

## What actually happened

### 1) The launch UI was mostly correct, but it was easy to misread

The delegation prompt is built in `src/runtime/contracts.ts:63-88` and includes the task, optional context, and expected output.
The extension renderers in `.pi/extensions/ghosty/index.ts:1768-1784` and `.pi/extensions/ghosty/index.ts:1839-1860` show a compact version by default and the full prompt when expanded.

So the prompt was not missing; it was just collapsed in the normal view.
That made the flow look more broken than it was.

### 2) The corroborator did not see peer results soon enough

The current injection path in `.pi/extensions/ghosty/index.ts:1387-1394` uses `pi.sendMessage(..., { triggerTurn: true, deliverAs: "followUp" })`.
That is asynchronous and best-effort, but it does **not** make the corroborator see the peer result immediately while the corroborator is still in its current turn.

That is the core visibility bug:

- the peer can finish,
- the result can be queued,
- but the corroborator is still busy,
- so the result arrives only after the turn ends.

That is not a minor lag. that is **too late period** if the current decision depends on the peer output.

The hard rule we need is this
if the corroborator needs the peer result to make the next move, that delegation belongs in a waiting path or a later turn. if it does not need the result immediately, then non-blocking is fine and should stay.

### 3) The peer report was not persisted in the way the user expected

The peer report tool is defined in `src/runtime/peerReportTool.ts:1-22`.
It returns structured `PeerOutput` (`summary`, `findings`, `artifacts`, `next_actions`) and the extension path later formats that into a custom message.

What we did **not** do was persist the literal peer transcript as part of the durable delegation report by default.

That means:

- the structured report exists,
- but the raw coder wording may not appear in `docs/reference`-style report artifacts,
- and if the peer never emitted a usable `peer_report`, the report file only contains the fallback summary shape.

If you want the literal coder response preserved, the report format needs an explicit transcript/raw-text field, not just structured summary fields.

### 4) Peer work kept running after it had already done the useful part

This is the credits-wasting failure mode.

The peer was allowed to keep processing even after the useful `peer_report` was already available.
So the work was effectively done, but the session kept consuming tokens because nothing forced an early stop/cancel/idle transition.

That is a separate bug from the visibility lag.
Even with non-blocking delegation preserved, peer execution still needs an early stop rule once the report has been captured.

### 5) Routing fell back in a noisy way

The runtime trace shows route and semantic-enrichment failures caused by `Unsupported parameter: temperature`:

- `/home/poop/runs/pi-ghosty/data/traces/runtime/c418ffd4-ffb7-4aad-b465-9b6cf96d4b44.jsonl:2,6,11,18,22,26,30`
- delegation starts/ends around the same window: `:4,9,16,28,33`

That fallback behavior made the session reuse pattern less predictable and contributed to the feeling that delegation was behaving strangely.

### 6) “Broken” sometimes meant “not expanded”

The full prompt and the structured result were there, but the default display was compact.
That made it look like data was missing when it was mostly just hidden behind expansion.

That is an important UX failure mode: the feature existed, but it was not obvious enough during a fast-moving session.

## Failure modes to inspect next

1. **Corroborator visibility lag**
   - The result injection path only becomes visible after the corroborator turn ends.
   - Inspect the follow-up message delivery path and whether it should use a true durable session entry first.

2. **Durable report shape**
   - The delegation report does not currently guarantee the literal peer transcript or coder wording.
   - Inspect `DelegationReport`/`PeerOutput` and decide whether raw peer text should be persisted.

3. **Peer turn termination**
   - The peer can continue after `peer_report` already delivered the useful answer.
   - Inspect whether peer completion should stop the session immediately after the report is captured.

4. **Routing fallback noise**
   - The `temperature` parameter mismatch is causing resume fallbacks and semantic enrichment errors.
   - Inspect routing/model request construction and the fallback path.

5. **Renderer clarity**
   - The full delegation prompt is available but not obvious in the compact view.
   - Inspect the tool renderers so the full envelope is easier to discover without forcing expansion.

6. **Session/report alignment**
   - The peer report exists as a structured result, but the report artifact and the visible corroborator session do not yet line up in the way the user expected.
   - Inspect the injection path so the report is both durable and visible at the right time.

## Practical takeaway

This incident was not “delegation doesn’t work at all.”
It was:

- the prompt was there but not obvious,
- the peer result was queued but not visible in time,
- the raw coder response was not durably preserved in the report the way the user expected,
- and the peer was allowed to keep spending credits after the useful answer had already arrived.

The non-blocking model is still the right model.
The thing that has to harden is the contract around it

- if you need peer output to decide the next step, do not delegate inside that same decision branch,
- if you do delegate, keep moving and treat the result as a future event,
- if the result matters, make the follow-up explicit instead of hoping the corroborator magically waits,
- and once the useful answer exists, stop burning tokens on the rest of the chatter.

That is the set of failure modes that should be fixed before trusting this flow again.
