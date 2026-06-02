import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

/** Minimal push-based async queue used to turn stdout lines into an async iterable. */
class AsyncQueue<T> implements AsyncIterableIterator<T> {
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

export interface LineProcess {
  /** stdout, line by line, as it arrives. */
  lines: AsyncIterableIterator<string>;
  /** Everything written to stderr so far (useful for error reporting). */
  stderr(): string;
  /** Resolves with the process exit code when it closes. */
  exit: Promise<number | null>;
  /** Terminate the child early (SIGTERM) — e.g. to halt a turn at a question. */
  kill(): void;
}

export interface SpawnOptions {
  cwd?: string;
  signal?: AbortSignal;
  /** If provided, written to stdin then closed. Otherwise stdin is closed immediately. */
  input?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Spawn a CLI and stream its stdout as newline-delimited lines.
 * The adapters parse those lines (NDJSON for Claude/pi, plain text for Hermes).
 */
export function spawnLineProcess(bin: string, args: string[], opts: SpawnOptions = {}): LineProcess {
  const child = spawn(bin, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const queue = new AsyncQueue<string>();
  const rl = createInterface({ input: child.stdout });
  rl.on("line", (l) => queue.push(l));
  rl.on("close", () => queue.end());

  let stderrText = "";
  child.stderr.on("data", (d: Buffer) => {
    stderrText += d.toString();
  });

  // Surface spawn failures (e.g. binary not found) as the exit promise rejection path.
  child.on("error", (err) => {
    stderrText += `\n[spawn error] ${(err as Error).message}`;
    queue.end();
  });

  if (opts.input !== undefined) {
    child.stdin.write(opts.input);
  }
  child.stdin.end();

  const exit = new Promise<number | null>((resolve) => {
    child.on("close", (code) => resolve(code));
  });

  if (opts.signal) {
    if (opts.signal.aborted) child.kill("SIGTERM");
    else opts.signal.addEventListener("abort", () => child.kill("SIGTERM"), { once: true });
  }

  return { lines: queue, stderr: () => stderrText, exit, kill: () => child.kill("SIGTERM") };
}

/**
 * Run a CLI to completion and return its full stdout (for non-streaming
 * one-shot harnesses like Hermes). Throws on non-zero exit.
 */
export async function runToString(bin: string, args: string[], opts: SpawnOptions = {}): Promise<string> {
  const proc = spawnLineProcess(bin, args, opts);
  const out: string[] = [];
  for await (const line of proc.lines) out.push(line);
  const code = await proc.exit;
  if (code !== 0) {
    throw new Error(`${bin} exited with code ${code}: ${proc.stderr().trim() || "(no stderr)"}`);
  }
  return out.join("\n");
}
