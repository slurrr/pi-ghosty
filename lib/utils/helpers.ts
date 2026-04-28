export function lastAssistantText(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== "assistant") continue;
    const content = message?.content;
    if (typeof content === "string" && content.trim()) return content;
    if (Array.isArray(content)) {
      const text = content
        .filter((block: any) => block?.type === "text" && typeof block?.text === "string")
        .map((block: any) => block.text)
        .join("");
      if (text.trim()) return text;
    }
  }
  return "(no assistant text)";
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function extractJsonObject(text: string): string | undefined {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = (fenced?.[1] ?? trimmed).trim();
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return undefined;
  return candidate.slice(first, last + 1);
}

export function safeJsonParse<T>(text: string): T | undefined {
  const extracted = extractJsonObject(text) ?? text;
  try {
    return JSON.parse(extracted) as T;
  } catch {
    return undefined;
  }
}
