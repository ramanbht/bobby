import { randomUUID } from "node:crypto";
import type { Chat, Message, MessageMeta, Plan, ServerFrame } from "@bobby/shared";
import { getAdapter } from "./adapters/index.js";
import { chatWorkdir, config } from "./config.js";
import * as db from "./db.js";
import { distillChat } from "./memory/distill.js";

type Emit = (frame: ServerFrame) => void;

/** Per-chat abort controllers for in-flight plan execution (so "stop" can halt it). */
const running = new Map<string, AbortController>();

export function stopChat(chatId: string): void {
  running.get(chatId)?.abort();
}

/* ------------------------------------------------------------------ */
/* Normal turn                                                        */
/* ------------------------------------------------------------------ */

export async function runTurn(chat: Chat, userText: string, emit: Emit): Promise<void> {
  const history = db.listMessages(chat.id);
  const userMsg = db.addMessage({ chatId: chat.id, role: "user", content: userText });
  emit({ type: "user-message", message: userMsg });
  autoTitle(chat, userText, history.length);
  await streamAssistant(chat, userText, history, emit);
}

export async function editAndRerun(
  chat: Chat,
  messageId: string,
  newText: string,
  emit: Emit,
): Promise<void> {
  const target = db.getMessage(messageId);
  if (!target || target.chatId !== chat.id) {
    emit({ type: "error", chatId: chat.id, message: "message not found" });
    return;
  }
  if (target.role !== "user") {
    emit({ type: "error", chatId: chat.id, message: "only user messages can be edited" });
    return;
  }
  db.updateMessage(messageId, newText, null);
  db.deleteMessagesAfter(chat.id, messageId);
  db.clearHarnessSession(chat.id);
  chat.harnessSessionId = null;
  emit({ type: "user-message", message: { ...target, content: newText } });
  // After truncation, only [messages-before-target, target] remain. History for
  // the new turn is everything except target itself (tie-safe by id, not time).
  const history = db.listMessages(chat.id).filter((m) => m.id !== messageId);
  await streamAssistant(chat, newText, history, emit);
}

/* ------------------------------------------------------------------ */
/* Plan-then-execute                                                  */
/* ------------------------------------------------------------------ */

const PLAN_INSTRUCTIONS =
  "Before doing anything, produce a concise step-by-step PLAN for the request below. " +
  "Output a numbered list — one concrete action per line — and nothing else. " +
  "Do NOT execute any step yet; only plan.\n\nRequest:\n";

/** Propose a plan for the user's request without executing it. */
export async function runPlan(chat: Chat, userText: string, emit: Emit): Promise<void> {
  const history = db.listMessages(chat.id);
  const userMsg = db.addMessage({ chatId: chat.id, role: "user", content: userText });
  emit({ type: "user-message", message: userMsg });
  autoTitle(chat, userText, history.length);
  await streamAssistant(chat, PLAN_INSTRUCTIONS + userText, history, emit, {
    planMode: true,
    asPlan: true,
  });
}

/** Approve a proposed plan: kick off step 1. The plan then pauses between steps. */
export function executePlan(chat: Chat, messageId: string, emit: Emit): Promise<void> {
  return runNextStep(chat, messageId, emit);
}

/** Advance one step further in a paused plan execution. */
export function continuePlan(chat: Chat, messageId: string, emit: Emit): Promise<void> {
  return runNextStep(chat, messageId, emit);
}

/**
 * Run the next pending step of a plan, then pause (or finish). Each step
 * requires its own explicit Continue — tight, not-yolo control.
 */
async function runNextStep(chat: Chat, messageId: string, emit: Emit): Promise<void> {
  const planMsg = db.getMessage(messageId);
  const plan = planMsg?.meta?.plan;
  if (!planMsg || !plan) {
    emit({ type: "error", chatId: chat.id, message: "plan not found" });
    return;
  }
  if (plan.status === "done" || plan.status === "cancelled") {
    emit({ type: "error", chatId: chat.id, message: `plan is ${plan.status}` });
    return;
  }

  const persistPlan = (next: Plan) => {
    const updated = db.setMessageMeta(messageId, { ...planMsg.meta, plan: next });
    emit({ type: "message-update", chatId: chat.id, message: updated });
  };

  const step = plan.steps.find((s) => s.status === "pending");
  if (!step) {
    plan.status = "done";
    persistPlan(plan);
    return;
  }

  const controller = new AbortController();
  running.set(chat.id, controller);
  plan.status = "running";
  step.status = "running";
  persistPlan(plan);

  let errored = false;
  try {
    const result = await streamAssistant(
      chat,
      `Execute step ${plan.steps.indexOf(step) + 1} of the approved plan, then stop:\n${step.text}`,
      db.listMessages(chat.id),
      emit,
      { signal: controller.signal },
    );
    errored = result.errored;
  } finally {
    step.status = errored ? "failed" : "done";
    const moreLeft = plan.steps.some((s) => s.status === "pending");
    plan.status = controller.signal.aborted
      ? "cancelled"
      : errored || !moreLeft
        ? "done"
        : "paused";
    persistPlan(plan);
    running.delete(chat.id);
  }
}

/** Extract step texts from an LLM's numbered/bulleted plan. Exported for testing. */
export function parsePlanSteps(text: string): string[] {
  const steps: string[] = [];
  for (const raw of text.split("\n")) {
    const m = raw.match(/^\s*(?:\d+[.)]|[-*])\s+(.+)$/);
    if (m && m[1].trim()) steps.push(m[1].trim().replace(/\*\*/g, ""));
  }
  return steps;
}

/* ------------------------------------------------------------------ */
/* Shared streaming core                                              */
/* ------------------------------------------------------------------ */

interface StreamOpts {
  planMode?: boolean;
  /** Parse the result into a proposed plan and attach it to the message meta. */
  asPlan?: boolean;
  signal?: AbortSignal;
}

async function streamAssistant(
  chat: Chat,
  promptText: string,
  history: Message[],
  emit: Emit,
  opts: StreamOpts = {},
): Promise<{ errored: boolean }> {
  const assistant = db.addMessage({ chatId: chat.id, role: "assistant", content: "" });
  emit({ type: "turn-start", chatId: chat.id, messageId: assistant.id });

  const adapter = getAdapter(chat.harness);
  const controller = new AbortController();
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  let deltaBuf = "";
  let textBlock = "";
  let doneText: string | undefined;
  let thinking = "";
  let errored = false;
  const meta: MessageMeta = {};

  try {
    for await (const event of adapter.run({
      prompt: promptText,
      history,
      harnessSessionId: chat.harnessSessionId,
      model: chat.model,
      config: chat.config,
      planMode: opts.planMode,
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

  if (opts.asPlan && !errored) {
    const steps = parsePlanSteps(finalText);
    if (steps.length) {
      meta.plan = {
        status: "proposed",
        steps: steps.map((text) => ({ id: randomUUID(), text, status: "pending" })),
      };
    }
  }

  const saved = db.updateMessage(assistant.id, finalText, Object.keys(meta).length ? meta : null);
  emit({ type: "turn-end", chatId: chat.id, message: saved });

  if (!errored && !opts.planMode && config.autoDistill && config.obsidianVault) {
    distillChat(chat, db.listMessages(chat.id)).catch((e) =>
      console.error("[distill] auto-distill failed:", (e as Error).message),
    );
  }
  return { errored };
}

function autoTitle(chat: Chat, userText: string, priorCount: number): void {
  if (chat.title === "New chat" && priorCount === 0) {
    const title = userText.replace(/\s+/g, " ").trim().slice(0, 60) || "New chat";
    db.renameChat(chat.id, title);
  }
}
