# Spec: Async delegation return path with durable peer reports

## Problem
`delegate` and `delegate_batch` currently wait for each peer to finish before returning to the coordinator. That keeps the coordinator blocked and makes peer work feel synchronous, even though the peer itself is already an independent session.

The desired behavior is:
- launch the peer immediately
- keep the coordinator free to keep chatting
- when the peer later calls `peer_report`, deliver that result back into the coordinator as a fresh turn
- keep a durable record of every peer report so it can be referenced later

## Scope
This is an extension-only change in `.pi/extensions/ghosty/index.ts` plus small shared helpers under `src/runtime/`.

Do **not** add a new runtime process or IPC bridge. Ghosty already owns the coordinator extension instance and the peer session objects in-process, so the reverse handoff can be done directly from the peer report callback.

## Goals
1. `delegate` and `delegate_batch` return immediately after launching peer work.
2. Each delegation gets a unique `jobId`.
3. The tool result shown for `delegate` / `delegate_batch` includes:
   - peer name
   - job id
   - the full delegation message that was sent to the peer
   - enough launch metadata to understand which session was used
4. `peer_report` writes a durable report file under the run directory.
5. When `peer_report` fires, Ghosty injects a message into the coordinator session that starts a new turn and looks tool-like/distinct from user/assistant messages.
6. The injected coordinator message should carry the same payload shape as the current peer result, amended with `jobId` and report metadata.
7. `delegate_batch` remains bounded/serialized by the existing concurrency policy, but it no longer waits for peer completion.

## Non-goals
- Do not convert peers into subagents.
- Do not add a separate watcher process or polling loop.
- Do not require manual collection of completed reports.
- Do not change the session-routing/catalog policy from the earlier work.

## Proposed flow
### Delegate launch
1. Coordinator calls `delegate` or `delegate_batch`.
2. Ghosty routes/resumes or creates the peer session as it does today.
3. Ghosty creates a unique `jobId` for the delegation.
4. Ghosty builds the exact delegation prompt/envelope and sends it to the peer.
5. The tool returns immediately with launch details.
6. The coordinator session remains free for additional conversation.

### Peer completion
1. The peer eventually calls `peer_report`.
2. Ghosty captures the report in the peer session tool callback.
3. Ghosty writes a durable record to:
   - `<runDir>/data/delegation-reports/<timestamp>-<peerName>-<jobId>.json`
  - `timestamp` should be a human-readable UTC ISO prefix (colons replaced for filenames) so files sort chronologically.
4. Ghosty injects a custom message into the coordinator session using the coordinator extension API.
5. The injected message should:
   - use a dedicated custom type
   - render like a tool result or similarly distinct system artifact
   - include `peerName`, `jobId`, `sessionId`, `sessionState`, `reportSource`, `output`, and the original delegation message
6. The injection should trigger a new coordinator turn when possible (`followUp`/triggered delivery), without blocking the original delegation tool call.

## Data model
### Delegation launch record
Used for the immediate tool result and for later debugging.

```ts
interface DelegationLaunch {
  title: string;               // `${peerName}-${jobId}`
  peerName: PeerName;
  jobId: string;
  sessionId: string;
  sessionState: "new" | "resumed";
  delegationMessage: string;
  routing?: {
    action: "resume" | "new" | "compact_then_resume";
    reason?: string;
    confidence?: number;
  };
  launchedAt: string;
}
```

### Delegation report record
Persisted durably and injected back into the coordinator session.

```ts
interface DelegationReportRecord {
  title: string;               // `${peerName}-${jobId}`
  peerName: PeerName;
  jobId: string;
  coordinatorSessionId: string;
  peerSessionId: string;
  sessionState: "new" | "resumed";
  delegationMessage: string;
  reportSource: "tool" | "text";
  rawText?: string;
  output: PeerOutput;
  reportPath: string;
  launchedAt: string;
  completedAt: string;
  routing?: DelegationLaunch["routing"];
}
```

## UI requirements
- `delegate` / `delegate_batch` should show the peer name and job id right away.
- The full delegation envelope should be visible in the expanded view.
- The completion injection should be visually distinct from normal user/assistant messages.
- If a true tool-result message cannot be injected cross-session, a custom message renderer must make the injected report obviously tool-like.

## Acceptance criteria
- `delegate` returns immediately after launch.
- `delegate_batch` returns immediately after launching all requests.
- Every launched delegation has a unique job id.
- Every completed peer report is written to a durable report file.
- Every completed peer report injects a coordinator message that starts a new turn when possible.
- The injected coordinator message is clearly distinguishable from ordinary user/assistant messages.
- Existing smoke validation still passes, even though the actual peer completion is now asynchronous.
