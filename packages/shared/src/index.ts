/**
 * @bobby/shared — the contract shared by the server, the harness adapters,
 * and the web UI. Everything that crosses a process boundary is defined here.
 */

/** The harnesses Bobby can drive. Adding a new one starts by extending this. */
export type HarnessId = "claude" | "hermes" | "pi";

export const HARNESSES: readonly HarnessId[] = ["claude", "hermes", "pi"] as const;

/** Role of a stored message in a chat. */
export type Role = "user" | "assistant" | "system";

/* ------------------------------------------------------------------ *
 * Normalized harness events
 *
 * Every adapter, whatever the underlying CLI emits (Claude's stream-json,
 * pi's --mode json, Hermes' oneshot text, or ACP notifications), normalizes
 * its output into this single event stream. The server persists these and
 * forwards them to the browser, so the UI only ever speaks one dialect.
 * ------------------------------------------------------------------ */

/** The harness reported (or was assigned) its native session id — lets us resume. */
export interface SessionEvent {
  type: "session";
  /** Harness-native session identifier (Claude UUID, pi session id, etc.). */
  sessionId: string;
}

/** Incremental assistant text (token-level streaming). Concatenate in order. */
export interface TextDeltaEvent {
  type: "text-delta";
  text: string;
}

/** A complete assistant text block. Non-streaming harnesses emit this once. */
export interface TextEvent {
  type: "text";
  text: string;
}

/** Incremental reasoning/thinking text, if the harness exposes it. */
export interface ThinkingDeltaEvent {
  type: "thinking-delta";
  text: string;
}

/** The assistant invoked a tool. */
export interface ToolUseEvent {
  type: "tool-use";
  id?: string;
  name: string;
  input: unknown;
}

/** Result of a tool the assistant invoked. */
export interface ToolResultEvent {
  type: "tool-result";
  id?: string;
  output: string;
  isError?: boolean;
}

/** Turn finished successfully. */
export interface DoneEvent {
  type: "done";
  /** Final assistant text, if the harness gives an authoritative one. */
  text?: string;
  usage?: TurnUsage;
  /** Raw final payload from the harness, kept for debugging. */
  raw?: unknown;
}

/** Turn failed. */
export interface ErrorEvent {
  type: "error";
  message: string;
}

export interface TurnUsage {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

export type HarnessEvent =
  | SessionEvent
  | TextDeltaEvent
  | TextEvent
  | ThinkingDeltaEvent
  | ToolUseEvent
  | ToolResultEvent
  | DoneEvent
  | ErrorEvent;

/* ------------------------------------------------------------------ *
 * Persistence model (mirrors the SQLite schema)
 * ------------------------------------------------------------------ */

/**
 * Per-chat advanced configuration. Each field is best-effort per harness:
 * - `agent`      → Claude `--agent <name>`
 * - `agentsJson` → Claude `--agents <json>` (inline custom agent definitions)
 * - `skills`     → Hermes `--skills a,b`, pi `--skill a --skill b`
 */
export interface ChatConfig {
  agent?: string;
  agentsJson?: string;
  skills?: string[];
}

export interface Chat {
  id: string;
  title: string;
  harness: HarnessId;
  model: string | null;
  config: ChatConfig | null;
  /** Harness-native session id captured from the first turn, used to resume. */
  harnessSessionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  chatId: string;
  role: Role;
  content: string;
  /** Optional structured detail: tool calls/results, usage, raw events. */
  meta: MessageMeta | null;
  createdAt: string;
}

export interface MessageMeta {
  toolCalls?: { id?: string; name: string; input: unknown }[];
  toolResults?: { id?: string; output: string; isError?: boolean }[];
  thinking?: string;
  usage?: TurnUsage;
  /** Present when this message is a proposed/executing plan (plan-then-execute mode). */
  plan?: Plan;
}

/* ------------------------------------------------------------------ *
 * Plan-then-execute
 *
 * Instead of full-yolo, a turn can first produce a reviewable plan. The user
 * approves it, then Bobby runs the steps one at a time with visible progress.
 * ------------------------------------------------------------------ */

export type PlanStatus = "proposed" | "running" | "done" | "cancelled";
export type StepStatus = "pending" | "running" | "done" | "failed";

export interface PlanStep {
  id: string;
  text: string;
  status: StepStatus;
}

export interface Plan {
  status: PlanStatus;
  steps: PlanStep[];
}

/* ------------------------------------------------------------------ *
 * REST payloads
 * ------------------------------------------------------------------ */

export interface CreateChatRequest {
  title?: string;
  harness: HarnessId;
  model?: string;
  config?: ChatConfig;
}

/** Patch an existing chat. Any provided field is updated; omitted fields are left as-is. */
export interface UpdateChatRequest {
  title?: string;
  harness?: HarnessId;
  model?: string | null;
  config?: ChatConfig | null;
}

export interface ChatWithMessages extends Chat {
  messages: Message[];
}

/** App-wide defaults, editable from the Settings panel (GET/PUT /api/settings). */
export interface AppSettings {
  /** Harness pre-selected when creating a new chat. */
  defaultHarness: HarnessId;
  /** Default model per harness, used to pre-fill the new-chat form. */
  models: Partial<Record<HarnessId, string>>;
  /** Default advanced config applied to new chats. */
  defaultConfig: ChatConfig;
}

export const DEFAULT_SETTINGS: AppSettings = {
  defaultHarness: "claude",
  models: {},
  defaultConfig: {},
};

export interface DistillResult {
  notePath: string;
  noteTitle: string;
  markdown: string;
}

/** Describes a harness for the UI (returned by GET /api/harnesses). */
export interface HarnessInfo {
  id: HarnessId;
  label: string;
  streaming: boolean;
  available: boolean;
}

/** Server-side feature flags for the UI (returned by GET /api/config). */
export interface ServerConfigInfo {
  obsidianConfigured: boolean;
  distillHarness: HarnessId;
  autoDistill: boolean;
}

/* ------------------------------------------------------------------ *
 * WebSocket wire protocol (browser <-> server)
 * ------------------------------------------------------------------ */

/** Client asks the server to run a turn in a chat. */
export interface SendMessageCommand {
  type: "send";
  chatId: string;
  text: string;
}

/**
 * Client edits an existing user message and re-runs from there: the server
 * rewrites that message, discards everything after it, and streams a fresh
 * assistant reply.
 */
export interface EditMessageCommand {
  type: "edit";
  chatId: string;
  messageId: string;
  text: string;
}

/** Ask the harness to propose a plan (no execution yet). */
export interface PlanCommand {
  type: "plan";
  chatId: string;
  text: string;
}

/** Approve a proposed plan and run its steps one at a time. */
export interface ExecutePlanCommand {
  type: "execute-plan";
  chatId: string;
  messageId: string;
}

/** Stop an in-flight plan execution for a chat. */
export interface StopCommand {
  type: "stop";
  chatId: string;
}

export type ClientCommand =
  | SendMessageCommand
  | EditMessageCommand
  | PlanCommand
  | ExecutePlanCommand
  | StopCommand;

/** Server -> client frames during a turn. */
export type ServerFrame =
  | { type: "user-message"; message: Message }
  | { type: "turn-start"; chatId: string; messageId: string }
  | { type: "event"; chatId: string; messageId: string; event: HarnessEvent }
  | { type: "turn-end"; chatId: string; message: Message }
  | { type: "message-update"; chatId: string; message: Message }
  | { type: "error"; chatId?: string; message: string };

/* ------------------------------------------------------------------ *
 * Scheduled jobs (cron)
 * ------------------------------------------------------------------ */

export interface Job {
  id: string;
  name: string;
  harness: HarnessId;
  model: string | null;
  prompt: string;
  /** Standard 5-field cron expression (e.g. "0 9 * * *"). */
  schedule: string;
  enabled: boolean;
  /** Dedicated chat where each run is recorded. */
  chatId: string;
  lastRunAt: string | null;
  lastStatus: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateJobRequest {
  name: string;
  harness: HarnessId;
  model?: string;
  prompt: string;
  schedule: string;
  enabled?: boolean;
}

export interface UpdateJobRequest {
  name?: string;
  model?: string | null;
  prompt?: string;
  schedule?: string;
  enabled?: boolean;
}
