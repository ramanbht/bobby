import type { ChatConfig, HarnessEvent, HarnessId, Message } from "@bobby/shared";

export interface TurnInput {
  /** The new user message to send this turn. */
  prompt: string;
  /**
   * Full prior conversation from Bobby's canonical store. Adapters for
   * harnesses that can't resume natively (Hermes oneshot) flatten this into
   * the prompt; adapters that can resume (Claude, pi) ignore it.
   */
  history: Message[];
  /** Harness-native session id captured from a previous turn, if any. */
  harnessSessionId?: string | null;
  /** Model string as the user typed it; passed through to the harness, or null for its default. */
  model?: string | null;
  /** Per-chat advanced config (agent, custom agents JSON, skills). */
  config?: ChatConfig | null;
  /** Working directory the harness subprocess runs in (its tools operate here). */
  cwd: string;
  /** Aborts the underlying subprocess. */
  signal: AbortSignal;
}

export interface HarnessAdapter {
  id: HarnessId;
  /** Human-friendly label for the UI. */
  label: string;
  /** Whether Bobby streams token deltas for this harness (vs. one final block). */
  streaming: boolean;
  /** Run one turn, yielding normalized events. */
  run(input: TurnInput): AsyncIterable<HarnessEvent>;
}

/** Render Bobby's stored history into a plain-text transcript (for oneshot harnesses). */
export function renderTranscript(history: Message[]): string {
  return history
    .filter((m) => m.role !== "system")
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");
}

/**
 * The prompt to send a harness this turn.
 *
 * When `resuming` is true the harness still holds the conversation in its own
 * native session, so we send only the new message. When it's false — a oneshot
 * harness, the first turn after editing/branching, or right after switching
 * harness — we replay Bobby's stored history so context isn't lost.
 */
export function promptWithHistory(input: TurnInput, resuming: boolean): string {
  if (resuming) return input.prompt;
  const transcript = renderTranscript(input.history);
  return transcript
    ? `${transcript}\n\nUser: ${input.prompt}\n\nContinue the conversation. Reply as Assistant.`
    : input.prompt;
}
