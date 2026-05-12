import type { ExtensionFactory } from "@mariozechner/pi-coding-agent";

/**
 * Minimal loop breaker.
 *
 * One counter: consecutive tool execution failures in the current agent loop.
 *
 * For n=3, messages are appended to failing tool results on failures:
 * - 4: soft steer
 * - 5: stronger steer
 * - 6: hard steer (peer: call peer_report now)
 * - 7: abort the turn
 */
export function loopBreakerExtensionFactory(options: {
  agentName: string;
  n: number;
}): ExtensionFactory {
  const { agentName, n } = options;
  const isWorkerPeer = agentName !== "corroborator";

  let failStreak = 0;

  // toolCallId -> streak when that tool finished.
  const streakByToolCallId = new Map<string, number>();

  // Peer-report loop guard: peer_report should be called once per delegated turn.
  let peerReportCount = 0;
  const duplicatePeerReportToolCallIds = new Set<string>();

  return (pi) => {
    pi.on("agent_start", () => {
      failStreak = 0;
      streakByToolCallId.clear();
      peerReportCount = 0;
      duplicatePeerReportToolCallIds.clear();
    });

    pi.on("tool_execution_end", (event, ctx) => {
      // Peer-report guard: if a peer calls peer_report more than once in a turn,
      // abort the turn so the corroborator can proceed with the first report.
      if (isWorkerPeer && event.toolName === "peer_report" && !event.isError) {
        peerReportCount += 1;
        if (peerReportCount >= 2) {
          duplicatePeerReportToolCallIds.add(event.toolCallId);
          ctx.abort();
        }
      }

      if (event.isError) {
        failStreak += 1;
      } else {
        failStreak = 0;
      }
      streakByToolCallId.set(event.toolCallId, failStreak);

      // Final safety valve: abort after n+4 consecutive failures.
      if (event.isError && failStreak >= n + 4) {
        ctx.abort();
      }
    });

    pi.on("tool_result", (event): { content?: any[] } | void => {
      // Annotate duplicate peer_report attempts so the corroborator/user can see what happened.
      if (duplicatePeerReportToolCallIds.has(event.toolCallId)) {
        const existing = Array.isArray(event.content) ? event.content : [];
        return {
          content: [
            ...existing,
            {
              type: "text",
              text: "\n\n[STOP] peer_report was called more than once in this peer turn; aborting to prevent a loop.",
            },
          ],
        };
      }

      const streak = streakByToolCallId.get(event.toolCallId);
      if (!streak) return;
      if (!event.isError) return;

      const existing = Array.isArray(event.content) ? event.content : [];

      const soft = isWorkerPeer
        ? "[STOP] Tool failed repeatedly. Try a different approach. If you cannot proceed, use peer_report with the blocker + next step."
        : "[STOP] Tool failed repeatedly. Try a different approach or delegate.";

      const stronger = isWorkerPeer
        ? "[STOP] Still failing. Stop retrying the same tool. Either proceed with available tools or peer_report the blocker + next step."
        : "[STOP] Still failing. Stop retrying the same tool. Change approach or delegate.";

      const hard = isWorkerPeer
        ? "[STOP] Call peer_report NOW with: (1) blocker (2) next step."
        : "[STOP] Tools are failing. STOP calling tools and change approach.";

      const aborting = "[STOP] Aborting this turn due to repeated tool failures.";

      let msg: string | null = null;
      if (streak === n + 1) msg = soft;
      else if (streak === n + 2) msg = stronger;
      else if (streak === n + 3) msg = hard;
      else if (streak === n + 4) msg = aborting;

      if (!msg) return;
      return { content: [...existing, { type: "text", text: `\n\n${msg}` }] };
    });
  };
}
