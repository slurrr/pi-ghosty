import { z } from "zod";

export const ghostyPeerNames = ["coder", "researcher", "reviewer", "memory"] as const;

export const delegateRequestSchema = z.object({
  peerName: z.enum(ghostyPeerNames),
  task: z.string().min(1),
  context: z.string().default(""),
  expectedOutput: z.string().default(""),
});

export const delegateBatchRequestSchema = z.object({
  requests: z.array(delegateRequestSchema).min(1),
});

export type DelegateRequest = z.infer<typeof delegateRequestSchema>;
export type DelegateBatchRequest = z.infer<typeof delegateBatchRequestSchema>;

export const peerOutputSchema = z.object({
  summary: z.string().min(1),
  findings: z.array(z.string().min(1)).optional(),
  artifacts: z.array(z.string().min(1)).optional(),
  next_actions: z.array(z.string().min(1)).optional(),
});

export type PeerOutput = z.infer<typeof peerOutputSchema>;

export interface PeerResult {
  peerName: (typeof ghostyPeerNames)[number];
  sessionId: string;
  sessionState: "new" | "resumed";
  output: PeerOutput;
  reportSource: "tool" | "text";
  rawText?: string;
  routing?: {
    action: "resume" | "new" | "compact_then_resume";
    reason?: string;
    confidence?: number;
  };
}

export function buildPeerDelegationPrompt(request: DelegateRequest, meta: { projectTag: string; coordinatorSessionId: string; peerSessionId: string; sessionState: "new" | "resumed" }): string {
  const sections = [
    `You are the ${request.peerName} peer in pi-ghosty.`,
    `Role: specialist peer.`,
    `Project: ${meta.projectTag}`,
    `Coordinator session: ${meta.coordinatorSessionId}`,
    `Peer session: ${meta.peerSessionId}`,
    `Peer session state: ${meta.sessionState}`,
    "",
    "# Task",
    request.task.trim(),
  ];

  if (request.context.trim()) {
    sections.push("", "# Context", request.context.trim());
  }

  if (request.expectedOutput.trim()) {
    sections.push("", "# Expected Output", request.expectedOutput.trim());
  }

  sections.push(
    "",
    "# Output",
    'Call the "peer_report" tool with your result.',
    "Do not write additional text.",
  );
  return sections.join("\n");
}

export const routingDecisionSchema = z.object({
  action: z.enum(["resume", "new", "compact_then_resume"]),
  sessionId: z.string().optional(),
  reason: z.string().default(""),
  confidence: z.number().min(0).max(1).default(0),
});

export type RoutingDecision = z.infer<typeof routingDecisionSchema>;

export function parsePeerOutput(rawText: string): { output: PeerOutput; parseError?: string } {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return { output: { summary: "(empty peer response)" }, parseError: "empty_response" };
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const out = peerOutputSchema.parse(parsed);
    return { output: out };
  } catch (err) {
    return { output: { summary: trimmed }, parseError: err instanceof Error ? err.message : String(err) };
  }
}
