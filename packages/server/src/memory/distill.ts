import type { Chat, DistillResult, HarnessId, Message } from "@bobby/shared";
import { config } from "../config.js";
import { runToString } from "../adapters/proc.js";
import { renderTranscript } from "../adapters/types.js";
import { writeNote } from "./obsidian.js";

const DISTILL_INSTRUCTIONS = `You are a memory distiller for a personal knowledge base (Obsidian).
Read the conversation transcript below and extract the durable, reusable knowledge from it:
decisions made, facts established, preferences expressed, and useful conclusions. Ignore
small talk, transient debugging chatter, and anything not worth remembering later.

Output GitHub-flavored Markdown ONLY, in exactly this shape:

# <a short, specific note title (5-10 words)>

- <atomic fact or decision worth remembering>
- <another one>

Use [[wikilinks]] around key concepts where natural so the note connects in the vault.
If there is genuinely nothing worth saving, output exactly: # (nothing to distill)`;

/** Run a one-shot prompt through the chosen harness and return its text. */
async function oneshot(harness: HarnessId, prompt: string): Promise<string> {
  switch (harness) {
    case "claude":
      return runToString(config.bin.claude, [
        "-p",
        "--permission-mode",
        "default",
        prompt,
      ]);
    case "hermes":
      return runToString(config.bin.hermes, ["-z", prompt, "--accept-hooks"]);
    case "pi":
      return runToString(config.bin.pi, ["-p", "--no-session", prompt]);
  }
}

/** Parse the harness output into { title, body }. Exported for testing. */
export function parseNote(markdown: string): { title: string; body: string } | null {
  const text = markdown.trim();
  const match = text.match(/^#\s+(.+)$/m);
  const title = match ? match[1].trim() : "";
  if (!title || /^\(nothing to distill\)$/i.test(title)) return null;
  // Body = everything after the first heading line.
  const idx = text.indexOf(match![0]) + match![0].length;
  const body = text.slice(idx).trim();
  return { title, body: body || "- (no details captured)" };
}

/**
 * Distill a chat into an Obsidian note. Returns null when there's nothing
 * worth saving. Throws if the vault isn't configured.
 */
export async function distillChat(chat: Chat, messages: Message[]): Promise<DistillResult | null> {
  if (!config.obsidianVault) {
    throw new Error("Obsidian vault not configured (set OBSIDIAN_VAULT).");
  }
  const transcript = renderTranscript(messages);
  if (!transcript.trim()) return null;

  const prompt = `${DISTILL_INSTRUCTIONS}\n\n--- TRANSCRIPT ---\n${transcript}\n--- END TRANSCRIPT ---`;
  const output = await oneshot(config.distillHarness, prompt);

  const parsed = parseNote(output);
  if (!parsed) return null;

  const written = writeNote({
    title: parsed.title,
    body: parsed.body,
    chatId: chat.id,
    harness: chat.harness,
  });

  return {
    notePath: written.notePath,
    noteTitle: written.noteTitle,
    markdown: written.markdown,
  };
}
