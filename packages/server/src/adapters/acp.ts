import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import type { HarnessEvent, TurnUsage } from "@bobby/shared";

/**
 * Minimal client for the Agent Client Protocol (ACP) — the JSON-RPC-over-stdio
 * dialect editors like Zed/VS Code use to drive an agent. Unlike a oneshot CLI
 * (which only prints the final answer), ACP streams `session/update`
 * notifications as the model thinks/types, so Bobby can show token-level
 * streaming. Hermes exposes this via `hermes acp`.
 *
 * We run one prompt per invocation: initialize → session/new → session/prompt,
 * translating each `session/update` into a normalized HarnessEvent.
 */

export interface AcpRunOptions {
  /** Binary that speaks ACP on stdio (e.g. the hermes CLI). */
  bin: string;
  /** Subcommand/args that start the ACP server (e.g. ["acp", "--accept-hooks"]). */
  acpArgs: string[];
  /** Full prompt text for this turn. */
  prompt: string;
  /** Working directory the agent's tools operate in. */
  cwd: string;
  /** Aborts the underlying subprocess. */
  signal: AbortSignal;
}

/* ------------------------------------------------------------------ */
/* Pure mappers (unit-tested without spawning a subprocess)            */
/* ------------------------------------------------------------------ */

/** Translate one ACP `session/update` payload into zero or more HarnessEvents. */
export function mapAcpUpdate(update: any): HarnessEvent[] {
  if (!update || typeof update !== "object") return [];
  switch (update.sessionUpdate) {
    case "agent_message_chunk": {
      const text = update.content?.text;
      return typeof text === "string" && text ? [{ type: "text-delta", text }] : [];
    }
    case "agent_thought_chunk": {
      const text = update.content?.text;
      return typeof text === "string" && text ? [{ type: "thinking-delta", text }] : [];
    }
    case "tool_call":
      return [
        {
          type: "tool-use",
          id: update.toolCallId ?? randomUUID(),
          name: update.title || update.kind || "tool",
          input: update.rawInput ?? {},
        },
      ];
    case "tool_call_update": {
      if (update.status !== "completed" && update.status !== "failed") return [];
      return [
        {
          type: "tool-result",
          id: update.toolCallId,
          output: extractAcpContent(update.content),
          isError: update.status === "failed",
        },
      ];
    }
    default:
      return []; // availableCommands, plan, current_mode_update, etc. — ignored
  }
}

/** Best-effort flatten of an ACP tool-call `content` array into plain text. */
export function extractAcpContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const item of content) {
    if (item?.type === "content" && item.content?.type === "text") parts.push(item.content.text ?? "");
    else if (item?.type === "diff") parts.push(item.path ?? "(diff)");
    else if (typeof item?.text === "string") parts.push(item.text);
  }
  return parts.join("");
}

/** Map ACP usage (token counts only; no cost for local models) into TurnUsage. */
export function mapAcpUsage(usage: any): TurnUsage {
  return {
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
    costUsd: usage?.costUsd,
  };
}

/* ------------------------------------------------------------------ */
/* Async queue bridging push-notifications into a pull-based generator */
/* ------------------------------------------------------------------ */

class EventQueue<T> implements AsyncIterableIterator<T> {
  private values: T[] = [];
  private resolvers: ((r: IteratorResult<T>) => void)[] = [];
  private ended = false;
  push(v: T): void {
    const r = this.resolvers.shift();
    if (r) r({ value: v, done: false });
    else this.values.push(v);
  }
  end(): void {
    this.ended = true;
    let r: ((r: IteratorResult<T>) => void) | undefined;
    while ((r = this.resolvers.shift())) r({ value: undefined as never, done: true });
  }
  [Symbol.asyncIterator](): AsyncIterableIterator<T> {
    return this;
  }
  next(): Promise<IteratorResult<T>> {
    if (this.values.length) return Promise.resolve({ value: this.values.shift() as T, done: false });
    if (this.ended) return Promise.resolve({ value: undefined as never, done: true });
    return new Promise((resolve) => this.resolvers.push(resolve));
  }
}

/* ------------------------------------------------------------------ */
/* Driver                                                              */
/* ------------------------------------------------------------------ */

export async function* runAcpPrompt(opts: AcpRunOptions): AsyncIterable<HarnessEvent> {
  const child = spawn(opts.bin, opts.acpArgs, {
    cwd: opts.cwd,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const queue = new EventQueue<HarnessEvent>();
  const rl = createInterface({ input: child.stdout });
  let stderr = "";
  child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));

  let nextId = 1;
  const pending = new Map<number, (v: any) => void>();
  const request = (method: string, params: unknown) =>
    new Promise<any>((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  const respond = (id: number, result: unknown) =>
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");

  rl.on("line", (line) => {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return; // tolerate non-JSON log noise
    }
    // Response to one of our requests.
    if (msg.id !== undefined && msg.method === undefined) {
      const resolve = pending.get(msg.id);
      if (resolve) {
        pending.delete(msg.id);
        resolve(msg.error ? { __error: msg.error } : msg.result);
      }
      return;
    }
    // Streaming notification.
    if (msg.method === "session/update") {
      for (const ev of mapAcpUpdate(msg.params?.update)) queue.push(ev);
      return;
    }
    // Server → client request. Never leave one unanswered (would deadlock).
    if (msg.id !== undefined && msg.method) {
      respond(msg.id, replyToServerRequest(msg.method, msg.params));
    }
  });

  const onAbort = () => child.kill("SIGTERM");
  if (opts.signal.aborted) child.kill("SIGTERM");
  else opts.signal.addEventListener("abort", onAbort, { once: true });

  child.on("error", (err) => {
    queue.push({ type: "error", message: (err as Error).message });
    queue.end();
  });
  child.on("close", () => queue.end());

  // Drive the protocol; terminal events get pushed onto the same queue so they
  // arrive after any streamed deltas already in flight.
  void (async () => {
    try {
      await request("initialize", {
        protocolVersion: 1,
        // Decline client-side fs/terminal so hermes uses its own tools (it's a
        // full standalone agent, not a thin ACP shim).
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      });
      const session = await request("session/new", { cwd: opts.cwd, mcpServers: [] });
      if (session?.__error) throw new Error(session.__error.message ?? "session/new failed");
      const result = await request("session/prompt", {
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: opts.prompt }],
      });
      if (result?.__error) throw new Error(result.__error.message ?? "session/prompt failed");
      queue.push({ type: "done", usage: mapAcpUsage(result?.usage), raw: result });
    } catch (err) {
      queue.push({ type: "error", message: (err as Error).message || stderr.trim() || "hermes acp failed" });
    } finally {
      queue.end();
    }
  })();

  try {
    for await (const ev of queue) yield ev;
  } finally {
    opts.signal.removeEventListener("abort", onAbort);
    child.kill("SIGKILL");
  }
}

/** Auto-respond to a server→client request consistent with Bobby's run-in-workdir posture. */
function replyToServerRequest(method: string, params: any): unknown {
  if (method === "session/request_permission") {
    const options: any[] = params?.options ?? [];
    const pick =
      options.find((o) => typeof o.kind === "string" && o.kind.startsWith("allow")) ?? options[0];
    return pick
      ? { outcome: { outcome: "selected", optionId: pick.optionId } }
      : { outcome: { outcome: "cancelled" } };
  }
  return {}; // fs/terminal requests we declined — empty is the safe no-op.
}
