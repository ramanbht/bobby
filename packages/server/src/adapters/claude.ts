import type { HarnessEvent } from "@bobby/shared";
import { config } from "../config.js";
import { spawnLineProcess } from "./proc.js";
import type { HarnessAdapter, TurnInput } from "./types.js";

/**
 * Parse a single line of Claude's `--output-format stream-json` NDJSON into
 * zero or more normalized HarnessEvents. Pure and synchronous so it can be
 * unit-tested without spawning a subprocess.
 */
export function parseClaudeStreamLine(line: string): HarnessEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  let evt: any;
  try {
    evt = JSON.parse(trimmed);
  } catch {
    return []; // tolerate non-JSON noise
  }
  const out: HarnessEvent[] = [];

  switch (evt.type) {
    case "system":
      if (evt.subtype === "init" && evt.session_id) {
        out.push({ type: "session", sessionId: evt.session_id });
      }
      break;

    case "stream_event": {
      const e = evt.event;
      if (e?.type === "content_block_delta") {
        const d = e.delta;
        if (d?.type === "text_delta" && d.text) out.push({ type: "text-delta", text: d.text });
        else if (d?.type === "thinking_delta" && d.thinking)
          out.push({ type: "thinking-delta", text: d.thinking });
      }
      break;
    }

    case "assistant": {
      const content = evt.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "tool_use") {
            out.push({ type: "tool-use", id: block.id, name: block.name, input: block.input });
          }
        }
      }
      break;
    }

    case "user": {
      const content = evt.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "tool_result") {
            const text = Array.isArray(block.content)
              ? block.content.map((c: any) => c.text ?? "").join("")
              : String(block.content ?? "");
            out.push({
              type: "tool-result",
              id: block.tool_use_id,
              output: text,
              isError: !!block.is_error,
            });
          }
        }
      }
      break;
    }

    case "result": {
      if (evt.is_error || evt.subtype === "error_during_execution" || evt.subtype === "error_max_turns") {
        out.push({ type: "error", message: String(evt.result ?? evt.subtype ?? "Claude error") });
      } else {
        out.push({
          type: "done",
          text: typeof evt.result === "string" ? evt.result : undefined,
          usage: {
            inputTokens: evt.usage?.input_tokens,
            outputTokens: evt.usage?.output_tokens,
            costUsd: evt.total_cost_usd,
          },
          raw: evt,
        });
      }
      break;
    }
  }

  return out;
}

/**
 * Claude Code adapter — the flagship, fully streaming path. Drives
 * `claude -p --output-format stream-json --include-partial-messages` and
 * resumes via `-r <session_id>`. Supports custom agents (`--agent`,
 * `--agents`).
 */
export const claudeAdapter: HarnessAdapter = {
  id: "claude",
  label: "Claude Code",
  streaming: true,

  async *run(input: TurnInput): AsyncIterable<HarnessEvent> {
    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--verbose",
      "--permission-mode",
      config.claudePermissionMode,
    ];
    if (input.model) args.push("--model", input.model);
    if (input.config?.agent) args.push("--agent", input.config.agent);
    if (input.config?.agentsJson) args.push("--agents", input.config.agentsJson);
    if (input.harnessSessionId) args.push("-r", input.harnessSessionId);
    args.push(input.prompt);

    const proc = spawnLineProcess(config.bin.claude, args, {
      cwd: input.cwd,
      signal: input.signal,
    });

    let terminal = false;
    for await (const line of proc.lines) {
      for (const event of parseClaudeStreamLine(line)) {
        yield event;
        if (event.type === "done" || event.type === "error") terminal = true;
      }
      if (terminal) return;
    }

    // Stream ended without a result event — report based on exit code.
    const code = await proc.exit;
    if (code !== 0) {
      yield { type: "error", message: proc.stderr().trim() || `claude exited with code ${code}` };
    } else {
      yield { type: "done" };
    }
  },
};
