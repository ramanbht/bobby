import type { HarnessEvent } from "@bobby/shared";
import { config } from "../config.js";
import { runToString } from "./proc.js";
import { promptWithHistory, type HarnessAdapter, type TurnInput } from "./types.js";

/**
 * Hermes adapter — uses oneshot mode (`hermes -z`), which prints only the
 * final response text. It has no streaming or exposed session id, so Bobby
 * supplies continuity itself: we flatten our canonical chat history into the
 * prompt. (Token streaming via `hermes acp` is a roadmap item.)
 */
export const hermesAdapter: HarnessAdapter = {
  id: "hermes",
  label: "Hermes",
  streaming: false,

  async *run(input: TurnInput): AsyncIterable<HarnessEvent> {
    // Hermes oneshot has no resumable session, so always replay Bobby's history.
    const prompt = promptWithHistory(input, false);

    const args = ["-z", prompt, "--accept-hooks"];
    if (input.model) args.push("-m", input.model);
    if (input.config?.skills?.length) args.push("--skills", input.config.skills.join(","));

    try {
      const out = await runToString(config.bin.hermes, args, {
        cwd: input.cwd,
        signal: input.signal,
      });
      const text = out.trim();
      yield { type: "text", text };
      yield { type: "done", text };
    } catch (err) {
      yield { type: "error", message: (err as Error).message };
    }
  },
};
