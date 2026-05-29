import type { Chat, MessageMeta, ServerFrame } from "@bobby/shared";
import { getAdapter } from "./adapters/index.js";
import { chatWorkdir, config } from "./config.js";
import * as db from "./db.js";
import { distillChat } from "./memory/distill.js";

type Emit = (frame: ServerFrame) => void;

/**
 * Run a single conversational turn for a chat:
 *   persist user msg → stream the harness → persist assistant msg,
 * forwarding every step to the caller as ServerFrames.
 */
export async function runTurn(chat: Chat, userText: string, emit: Emit): Promise<void> {
  // History is the conversation *before* this turn (used by oneshot harnesses).
  const history = db.listMessages(chat.id);

  const userMsg = db.addMessage({ chatId: chat.id, role: "user", content: userText });
  emit({ type: "user-message", message: userMsg });

  // Auto-title a fresh chat from its first user message.
  if (chat.title === "New chat" && history.length === 0) {
    const title = userText.replace(/\s+/g, " ").trim().slice(0, 60) || "New chat";
    db.renameChat(chat.id, title);
  }

  // Assistant placeholder so the UI has a stable id to stream into.
  const assistant = db.addMessage({ chatId: chat.id, role: "assistant", content: "" });
  emit({ type: "turn-start", chatId: chat.id, messageId: assistant.id });

  const adapter = getAdapter(chat.harness);
  const controller = new AbortController();

  let deltaBuf = "";
  let textBlock = "";
  let doneText: string | undefined;
  let thinking = "";
  let errored = false;
  const meta: MessageMeta = {};

  try {
    for await (const event of adapter.run({
      prompt: userText,
      history,
      harnessSessionId: chat.harnessSessionId,
      model: chat.model,
      config: chat.config,
      cwd: chatWorkdir(chat.id),
      signal: controller.signal,
    })) {
      emit({ type: "event", chatId: chat.id, messageId: assistant.id, event });

      switch (event.type) {
        case "session":
          if (event.sessionId && event.sessionId !== chat.harnessSessionId) {
            db.setHarnessSession(chat.id, event.sessionId);
            chat.harnessSessionId = event.sessionId;
          }
          break;
        case "text-delta":
          deltaBuf += event.text;
          break;
        case "text":
          textBlock = event.text;
          break;
        case "thinking-delta":
          thinking += event.text;
          break;
        case "tool-use":
          (meta.toolCalls ??= []).push({ id: event.id, name: event.name, input: event.input });
          break;
        case "tool-result":
          (meta.toolResults ??= []).push({ id: event.id, output: event.output, isError: event.isError });
          break;
        case "done":
          doneText = event.text;
          if (event.usage) meta.usage = event.usage;
          break;
        case "error":
          errored = true;
          textBlock = textBlock || `⚠️ ${event.message}`;
          break;
      }
    }
  } catch (err) {
    errored = true;
    textBlock = `⚠️ ${(err as Error).message}`;
  }

  const finalText = doneText || deltaBuf || textBlock || (errored ? "⚠️ (no response)" : "");
  if (thinking) meta.thinking = thinking;

  const saved = db.updateMessage(
    assistant.id,
    finalText,
    Object.keys(meta).length ? meta : null,
  );
  emit({ type: "turn-end", chatId: chat.id, message: saved });

  // Auto-distill after a successful turn, if enabled and a vault is configured.
  if (!errored && config.autoDistill && config.obsidianVault) {
    distillChat(chat, db.listMessages(chat.id)).catch((e) =>
      console.error("[distill] auto-distill failed:", (e as Error).message),
    );
  }
}
