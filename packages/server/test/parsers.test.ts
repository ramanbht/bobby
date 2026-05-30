import { describe, expect, it } from "vitest";
import { parseClaudeStreamLine } from "../src/adapters/claude.js";
import { extractText, pluckText } from "../src/adapters/pi.js";
import { promptWithHistory, renderTranscript } from "../src/adapters/types.js";
import { parseNote } from "../src/memory/distill.js";
import { slugifyTitle } from "../src/memory/obsidian.js";
import type { Message } from "@bobby/shared";

describe("parseClaudeStreamLine", () => {
  it("captures the session id from a system/init line", () => {
    const events = parseClaudeStreamLine(
      JSON.stringify({ type: "system", subtype: "init", session_id: "abc-123" }),
    );
    expect(events).toEqual([{ type: "session", sessionId: "abc-123" }]);
  });

  it("emits text-delta from a content_block_delta", () => {
    const events = parseClaudeStreamLine(
      JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hello" } } }),
    );
    expect(events).toEqual([{ type: "text-delta", text: "Hello" }]);
  });

  it("emits thinking-delta from a thinking_delta", () => {
    const events = parseClaudeStreamLine(
      JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "hmm" } } }),
    );
    expect(events).toEqual([{ type: "thinking-delta", text: "hmm" }]);
  });

  it("emits tool-use from an assistant message", () => {
    const events = parseClaudeStreamLine(
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }] } }),
    );
    expect(events).toEqual([{ type: "tool-use", id: "t1", name: "Bash", input: { command: "ls" } }]);
  });

  it("emits tool-result from a user message", () => {
    const events = parseClaudeStreamLine(
      JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "files" }], is_error: false }] } }),
    );
    expect(events).toEqual([{ type: "tool-result", id: "t1", output: "files", isError: false }]);
  });

  it("emits done with text + usage on a success result", () => {
    const events = parseClaudeStreamLine(
      JSON.stringify({ type: "result", subtype: "success", result: "Bobby is online.", usage: { input_tokens: 3, output_tokens: 7 }, total_cost_usd: 0.01 }),
    );
    expect(events).toEqual([
      { type: "done", text: "Bobby is online.", usage: { inputTokens: 3, outputTokens: 7, costUsd: 0.01 }, raw: expect.anything() },
    ]);
  });

  it("emits error on an error result", () => {
    const events = parseClaudeStreamLine(JSON.stringify({ type: "result", is_error: true, result: "boom" }));
    expect(events).toEqual([{ type: "error", message: "boom" }]);
  });

  it("ignores blank lines and non-JSON noise", () => {
    expect(parseClaudeStreamLine("")).toEqual([]);
    expect(parseClaudeStreamLine("not json")).toEqual([]);
  });
});

describe("pi text extraction", () => {
  it("plucks a top-level text field", () => {
    expect(pluckText({ text: "hi" })).toBe("hi");
  });
  it("plucks from a nested object", () => {
    expect(pluckText({ result: { content: "deep" } })).toBe("deep");
  });
  it("returns null when nothing string-like is present", () => {
    expect(pluckText({ foo: 1 })).toBeNull();
  });
  it("extractText parses a single JSON object", () => {
    expect(extractText([JSON.stringify({ response: "answer" })])).toBe("answer");
  });
  it("extractText parses the last line of NDJSON", () => {
    expect(extractText(['{"type":"start"}', JSON.stringify({ text: "final" })])).toBe("final");
  });
  it("extractText falls back to raw text when not JSON", () => {
    expect(extractText(["just plain output"])).toBe("just plain output");
  });
});

describe("distill parseNote", () => {
  it("splits title and body", () => {
    expect(parseNote("# My Title\n\n- fact one\n- fact two")).toEqual({
      title: "My Title",
      body: "- fact one\n- fact two",
    });
  });
  it("returns null for the sentinel", () => {
    expect(parseNote("# (nothing to distill)")).toBeNull();
  });
  it("returns null when there is no heading", () => {
    expect(parseNote("just some text")).toBeNull();
  });
});

describe("slugifyTitle", () => {
  it("strips filesystem-hostile characters", () => {
    expect(slugifyTitle('a/b:c*?"<>|#^[]')).not.toMatch(/[\\/:*?"<>|#^[\]]/);
  });
  it("falls back to a default for empty input", () => {
    expect(slugifyTitle("   ")).toBe("Untitled note");
  });
  it("caps the length", () => {
    expect(slugifyTitle("x".repeat(200)).length).toBeLessThanOrEqual(80);
  });
});

describe("renderTranscript", () => {
  it("formats user/assistant turns and drops system messages", () => {
    const msgs = [
      { role: "system", content: "sys" },
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ] as Message[];
    expect(renderTranscript(msgs)).toBe("User: hello\n\nAssistant: hi there");
  });
});

describe("promptWithHistory", () => {
  const base = { prompt: "next", history: [], cwd: "/tmp", signal: new AbortController().signal };
  const history = [
    { role: "user", content: "a" },
    { role: "assistant", content: "b" },
  ] as Message[];

  it("sends only the new prompt when resuming a native session", () => {
    expect(promptWithHistory({ ...base, history }, true)).toBe("next");
  });

  it("replays prior history when not resuming (branch / oneshot / harness switch)", () => {
    const out = promptWithHistory({ ...base, history }, false);
    expect(out).toContain("User: a");
    expect(out).toContain("Assistant: b");
    expect(out).toContain("User: next");
  });

  it("sends only the prompt when there is no history", () => {
    expect(promptWithHistory({ ...base, history: [] }, false)).toBe("next");
  });
});

import { isValidSchedule } from "../src/scheduler.js";

describe("isValidSchedule (cron)", () => {
  it("accepts standard 5-field cron", () => {
    expect(isValidSchedule("0 9 * * *")).toBe(true);
    expect(isValidSchedule("*/15 * * * *")).toBe(true);
    expect(isValidSchedule("0 9 * * 1-5")).toBe(true);
  });
  it("rejects nonsense", () => {
    expect(isValidSchedule("not a cron")).toBe(false);
    expect(isValidSchedule("")).toBe(false);
  });
});
