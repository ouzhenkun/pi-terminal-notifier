export function getTurnTrigger(messages: any[]): any | null {
  let seenTail = false;
  for (let i = messages.length - 1; i >= 0; i--) {
    const role = messages[i]?.role;
    if (role === "assistant" || role === "toolResult") {
      seenTail = true;
      continue;
    }
    if (seenTail) return messages[i];
  }
  return null;
}

export function extractLastAssistantText(messages: any[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== "assistant") continue;

    const content = message.content;
    if (typeof content === "string") return stripAnsi(content.trim()) || null;
    if (Array.isArray(content)) {
      return (
        stripAnsi(
          content
            .filter((part: any) => part?.type === "text" && typeof part.text === "string")
            .map((part: any) => part.text)
            .join("\n")
            .trim(),
        ) || null
      );
    }
    return null;
  }
  return null;
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\][^\x07]*\x07/g, "");
}

export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]*`/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
}
