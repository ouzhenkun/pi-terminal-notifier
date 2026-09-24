import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { extractLastAssistantText, getTurnTrigger, stripMarkdown } from "./core/messages.ts";
import { createNotifier } from "./core/notifier.ts";
import { createTerminalContext } from "./core/terminal.ts";

const NOTIFY_EVENT = "pi-terminal-notifier:notify";
const MAX_ERROR_BODY_LENGTH = 200;

const SOUNDS = {
  taskComplete: "task-complete",
  question: "question",
  error: "error",
  planReady: "plan-ready",
  reviewComplete: "review-complete",
} as const;

let registered = false;

export default function registerNotify(pi: ExtensionAPI): void {
  if (registered) return;
  registered = true;

  const argv = process.argv.slice(2);
  if (argv.includes("--no-session") || argv.includes("-p")) return;

  const notifier = createNotifier(__dirname, createTerminalContext());
  let suppressAgentEndNotify = false;
  let settledMessages: any[] | null = null;

  // agent_end also fires before an automatic retry and the extension event carries no
  // willRetry flag, so hold the messages until agent_settled decides for the whole run.
  pi.on("agent_end", async (event: any) => {
    settledMessages = event.messages ?? null;
  });

  pi.on("agent_settled", async () => {
    try {
      const messages = settledMessages;
      settledMessages = null;
      const wasSuppressed = suppressAgentEndNotify;
      suppressAgentEndNotify = false;
      if (wasSuppressed || !messages?.length) return;

      const trigger = getTurnTrigger(messages);
      if (trigger?.role !== "user") return;

      const text = extractLastAssistantText(messages);

      const lastMessage = messages[messages.length - 1];
      const isError = lastMessage?.stopReason === "error" || !!lastMessage?.errorMessage;

      if (isError) {
        const body = lastMessage?.errorMessage
          ? lastMessage.errorMessage.slice(0, MAX_ERROR_BODY_LENGTH)
          : text?.slice(0, MAX_ERROR_BODY_LENGTH) || "Unknown error";
        notifier.send("❌ Task Failed", body, { sound: SOUNDS.error });
        return;
      }

      if (!text) return;

      const stripped = stripMarkdown(text);
      const body = stripped.length > 120 ? stripped.slice(0, 119) + "\u2026" : stripped;
      notifier.send("✅ Task Complete", body, { sound: SOUNDS.taskComplete });
    } catch {
      // Notification failures must not interrupt pi.
    }
  });

  const offNotify = pi.events.on(NOTIFY_EVENT, async (event: any) => {
    try {
      suppressAgentEndNotify = true;
      Promise.resolve().then(() => {
        suppressAgentEndNotify = false;
      });

      notifier.send(event?.title ?? "Pi Notify", event?.body ?? "", {
        subtitle: event?.subtitle,
        sound: event?.sound ?? SOUNDS.taskComplete,
        group: event?.group,
        force: event?.force,
      });
    } catch {
      // Notification failures must not interrupt pi.
    }
  });

  pi.on("session_shutdown", async () => {
    offNotify();
    registered = false;
  });
}
