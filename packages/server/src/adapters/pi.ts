import path from "node:path";
import type { HarnessEvent } from "@bobby/shared";
import { config } from "../config.js";
import { spawnLineProcess } from "./proc.js";
import type { HarnessAdapter, TurnInput } from "./types.js";

/**
 * pi adapter — uses `pi -p --mode json`, which returns a structured result per
 * turn (per-turn, not token-streaming). Each chat gets its own session
 * directory so `--continue` unambiguously resumes that chat.
 */
export const piAdapter: HarnessAdapter = {
  id: "pi",
  label: "pi",
  streaming: false,

  async *run(input: TurnInput): AsyncIterable<HarnessEvent> {
    const sessionDir = path.join(input.cwd, ".pi-session");
    const args = ["-p", "--mode", "json", "--session-dir", sessionDir];
    if (input.model) args.push("--model", input.model);
    for (const skill of input.config?.skills ?? []) args.push("--skill", skill);
    // A prior turn means a session already exists in this chat's session dir.
    if (input.history.some((m) => m.role === "assistant")) args.push("--continue");
    args.push(input.prompt);

    const proc = spawnLineProcess(config.bin.pi, args, {
      cwd: input.cwd,
      signal: input.signal,
    });

    // pi --mode json may emit a single object or NDJSON; collect everything,
    // then extract the assistant text defensively.
    const raw: string[] = [];
    for await (const line of proc.lines) raw.push(line);
    const code = await proc.exit;

    if (code !== 0) {
      yield { type: "error", message: proc.stderr().trim() || `pi exited with code ${code}` };
      return;
    }

    const text = extractText(raw);
    yield { type: "text", text };
    yield { type: "done", text };
  },
};

/** Best-effort extraction of the assistant reply from pi's JSON output. */
export function extractText(lines: string[]): string {
  const joined = lines.join("\n").trim();

  // Try whole-output JSON, then last-line JSON (NDJSON), then raw text.
  const candidates = [joined, lines[lines.length - 1] ?? ""];
  for (const c of candidates) {
    if (!c) continue;
    try {
      const obj = JSON.parse(c);
      const found = pluckText(obj);
      if (found) return found;
    } catch {
      // not JSON; fall through
    }
  }
  return joined;
}

export function pluckText(obj: any): string | null {
  if (obj == null) return null;
  if (typeof obj === "string") return obj;
  // Common shapes across CLI JSON outputs.
  for (const key of ["text", "response", "result", "content", "message", "output"]) {
    const v = obj[key];
    if (typeof v === "string" && v.trim()) return v;
    if (v && typeof v === "object") {
      const nested = pluckText(v);
      if (nested) return nested;
    }
  }
  return null;
}
