import { z } from "zod";

export const ghostyPeerNames = ["coder", "researcher", "reviewer", "memory"] as const;

export const delegateRequestSchema = z.object({
  peerName: z.enum(ghostyPeerNames),
  task: z.string().min(1),
  context: z.string().default(""),
  expectedOutput: z.string().default(""),
});

export type DelegateRequest = z.infer<typeof delegateRequestSchema>;

export interface PeerResult {
  peerName: (typeof ghostyPeerNames)[number];
  sessionId: string;
  sessionState: "new" | "resumed";
  summary: string;
}

export function buildPeerDelegationPrompt(request: DelegateRequest, meta: { projectTag: string; coordinatorSessionId: string; peerSessionId: string; sessionState: "new" | "resumed" }): string {
  const sections = [
    `You are the ${request.peerName} peer in pi-ghosty.`,
    `Role: boring specialist task rabbit.`,
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

  sections.push("", "# Output Format", "Return a concise specialist answer the coordinator can relay to the user.");
  return sections.join("\n");
}
