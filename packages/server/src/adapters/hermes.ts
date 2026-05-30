import type { HarnessEvent } from "@bobby/shared";
import { config } from "../config.js";
import { runAcpPrompt } from "./acp.js";
import { runToString } from "./proc.js";
import { promptWithHistory, type HarnessAdapter, type TurnInput } from "./types.js";

/**
 * Hermes adapter.
 *
 * Normal turns run over ACP (`hermes acp`), the Agent Client Protocol server
 * that streams `session/update` notifications — so Bobby shows token-level
 * streaming just like Claude.
 *
 * Planning turns instead use oneshot (`hermes -z … -t ""`): ACP has no
 * per-call tool-disable flag, so to keep the "no tools while planning" hard
 * guarantee we fall back to oneshot with an empty toolset. Plans are short and
 * non-streaming-critical, so losing live streaming there is an acceptable trade.
 *
 * Either way hermes has no resumable session Bobby can reuse, so we always
 * replay Bobby's canonical history into the prompt.
 */
export const hermesAdapter: HarnessAdapter = {
  id: "hermes",
  label: "Hermes",
  streaming: true,

  async *run(input: TurnInput): AsyncIterable<HarnessEvent> {
    if (input.planMode) {
      yield* runOneshot(input);
      return;
    }
    yield* runAcpPrompt({
      bin: config.bin.hermes,
      acpArgs: ["acp", "--accept-hooks"],
      prompt: promptWithHistory(input, false),
      cwd: input.cwd,
      signal: input.signal,
    });
  },
};

/** Non-streaming oneshot used for planning turns, with tools hard-disabled. */
async function* runOneshot(input: TurnInput): AsyncIterable<HarnessEvent> {
  const prompt = promptWithHistory(input, false);
  const args = ["-z", prompt, "--accept-hooks", "-t", ""];
  if (input.model) args.push("-m", input.model);
  if (input.config?.skills?.length) args.push("--skills", input.config.skills.join(","));

  try {
    const out = await runToString(config.bin.hermes, args, { cwd: input.cwd, signal: input.signal });
    const text = out.trim();
    yield { type: "text", text };
    yield { type: "done", text };
  } catch (err) {
    yield { type: "error", message: (err as Error).message };
  }
}
