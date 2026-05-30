/**
 * End-to-end coverage of turn orchestration — runTurn, runPlan, executePlan,
 * continuePlan, editAndRerun — driven by a scripted mock adapter so we exercise
 * the real DB, plan parsing, message-update emission, and session/branch logic
 * without spending LLM credits.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Chat, HarnessEvent, ServerFrame } from "@bobby/shared";

// Hoisted shared state the mock adapter reads from and writes to.
const ctl = vi.hoisted(() => ({
  scripted: [] as HarnessEvent[],
  lastInput: null as null | {
    prompt: string;
    historyLen: number;
    harnessSessionId: string | null | undefined;
    planMode: boolean;
  },
}));

vi.mock("../src/adapters/index.js", () => {
  const mock = {
    id: "claude" as const,
    label: "Mock",
    streaming: true,
    async *run(input: {
      prompt: string;
      history: unknown[];
      harnessSessionId?: string | null;
      planMode?: boolean;
    }) {
      ctl.lastInput = {
        prompt: input.prompt,
        historyLen: input.history.length,
        harnessSessionId: input.harnessSessionId,
        planMode: !!input.planMode,
      };
      for (const ev of ctl.scripted) yield ev;
    },
  };
  return {
    adapters: { claude: mock, hermes: mock, pi: mock },
    getAdapter: () => mock,
  };
});

const db = await import("../src/db.js");
const { runTurn, runPlan, executePlan, continuePlan, editAndRerun, stopChat, parsePlanSteps } =
  await import("../src/turn.js");

describe("turn orchestration (mock adapter)", () => {
  let chat: Chat;
  let frames: ServerFrame[];
  const emit = (f: ServerFrame) => frames.push(f);
  const reload = (id: string) => db.getChat(id)!;

  beforeEach(() => {
    chat = db.createChat({ harness: "claude", model: "sonnet", title: "orchestration test" });
    frames = [];
    ctl.scripted = [];
    ctl.lastInput = null;
  });

  it("runTurn streams text, captures session id, persists user + assistant messages", async () => {
    ctl.scripted = [
      { type: "session", sessionId: "sess-1" },
      { type: "text-delta", text: "Hel" },
      { type: "text-delta", text: "lo" },
      { type: "done", text: "Hello", usage: { costUsd: 0.001 } },
    ];
    await runTurn(chat, "hi there", emit);

    expect(ctl.lastInput?.prompt).toBe("hi there");
    expect(ctl.lastInput?.planMode).toBe(false);
    expect(frames.find((f) => f.type === "user-message")).toBeTruthy();
    expect(frames.find((f) => f.type === "turn-start")).toBeTruthy();
    expect(frames.find((f) => f.type === "turn-end")).toBeTruthy();

    const msgs = db.listMessages(chat.id);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("user");
    expect(msgs[1].role).toBe("assistant");
    expect(msgs[1].content).toBe("Hello");
    expect(msgs[1].meta?.usage?.costUsd).toBe(0.001);
    expect(reload(chat.id).harnessSessionId).toBe("sess-1");
  });

  it("runTurn auto-titles a fresh chat from the first user message", async () => {
    ctl.scripted = [{ type: "done", text: "" }];
    const fresh = db.createChat({ harness: "claude" }); // default title is "New chat"
    await runTurn(fresh, "Plan a trip to Kyoto next April", emit);
    expect(reload(fresh.id).title).toContain("Kyoto");
  });

  it("runPlan parses a numbered plan into MessageMeta.plan with proposed status", async () => {
    const planText = [
      "Here's the plan:",
      "1. First action",
      "2. Second action",
      "3. Third action",
    ].join("\n");
    ctl.scripted = [{ type: "done", text: planText }];
    await runPlan(chat, "do a thing", emit);

    expect(ctl.lastInput?.planMode).toBe(true); // tools hard-disabled during planning
    const assistant = db.listMessages(chat.id)[1];
    const plan = assistant.meta?.plan;
    expect(plan?.status).toBe("proposed");
    expect(plan?.steps).toHaveLength(3);
    expect(plan?.steps.map((s) => s.status)).toEqual(["pending", "pending", "pending"]);
    expect(plan?.steps[0].text).toBe("First action");
  });

  it("runPlan with no extractable steps does not attach a plan", async () => {
    ctl.scripted = [{ type: "done", text: "I cannot do that." }];
    await runPlan(chat, "x", emit);
    const assistant = db.listMessages(chat.id)[1];
    expect(assistant.meta?.plan).toBeUndefined();
  });

  it("executePlan runs only step 1 then pauses; continuePlan advances one step at a time", async () => {
    // Phase 1: produce the plan
    ctl.scripted = [{ type: "done", text: "1. one\n2. two\n3. three" }];
    await runPlan(chat, "x", emit);
    const planId = db.listMessages(chat.id)[1].id;

    // Phase 2: approve & step 1
    frames = [];
    ctl.scripted = [{ type: "done", text: "did one" }];
    await executePlan(reload(chat.id), planId, emit);
    let plan = db.getMessage(planId)?.meta?.plan;
    expect(plan?.status).toBe("paused");
    expect(plan?.steps.map((s) => s.status)).toEqual(["done", "pending", "pending"]);
    expect(frames.some((f) => f.type === "message-update")).toBe(true);

    // Phase 3: continue → step 2 → paused
    ctl.scripted = [{ type: "done", text: "did two" }];
    await continuePlan(reload(chat.id), planId, emit);
    plan = db.getMessage(planId)?.meta?.plan;
    expect(plan?.status).toBe("paused");
    expect(plan?.steps.map((s) => s.status)).toEqual(["done", "done", "pending"]);

    // Phase 4: final continue → done
    ctl.scripted = [{ type: "done", text: "did three" }];
    await continuePlan(reload(chat.id), planId, emit);
    plan = db.getMessage(planId)?.meta?.plan;
    expect(plan?.status).toBe("done");
    expect(plan?.steps.every((s) => s.status === "done")).toBe(true);
  });

  it("executePlan errors when the plan message has no plan meta", async () => {
    ctl.scripted = [{ type: "done", text: "just a reply, no plan" }];
    await runTurn(chat, "hi", emit);
    const asstId = db.listMessages(chat.id)[1].id;
    frames = [];
    await executePlan(reload(chat.id), asstId, emit);
    const err = frames.find((f) => f.type === "error");
    expect(err && err.type === "error" && err.message).toMatch(/plan not found/i);
  });

  it("stopChat aborts an in-flight step (plan ends 'cancelled')", async () => {
    ctl.scripted = [{ type: "done", text: "1. a\n2. b" }];
    await runPlan(chat, "x", emit);
    const planId = db.listMessages(chat.id)[1].id;

    // Scripted events that "stall" — use a generator that aborts when signal fires.
    // Easiest: have streamAssistant see an abort by calling stopChat mid-run.
    // We script a delayed yield using a custom mock for this one case.
    ctl.scripted = []; // adapter yields nothing — empty iteration
    const p = executePlan(reload(chat.id), planId, emit);
    stopChat(chat.id);
    await p;
    const plan = db.getMessage(planId)?.meta?.plan;
    expect(plan?.status).toBe("cancelled");
  });

  it("editAndRerun rewrites the message, truncates after, clears session, and re-streams", async () => {
    // First turn
    ctl.scripted = [
      { type: "session", sessionId: "first" },
      { type: "done", text: "reply 1" },
    ];
    await runTurn(chat, "first msg", emit);
    const userMsgId = db.listMessages(chat.id)[0].id;
    expect(db.listMessages(chat.id)).toHaveLength(2);
    expect(reload(chat.id).harnessSessionId).toBe("first");

    // Edit
    frames = [];
    ctl.scripted = [{ type: "done", text: "reply 2" }];
    await editAndRerun(reload(chat.id), userMsgId, "edited msg", emit);

    const msgs = db.listMessages(chat.id);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].id).toBe(userMsgId);
    expect(msgs[0].content).toBe("edited msg");
    expect(msgs[1].content).toBe("reply 2");
    // Session was cleared before the re-stream; the mock doesn't emit a new one.
    expect(reload(chat.id).harnessSessionId).toBeNull();
    // The adapter call received the cleared session (null/undefined).
    expect(ctl.lastInput?.harnessSessionId).toBeNull();
  });

  it("editAndRerun rejects editing an assistant message", async () => {
    ctl.scripted = [{ type: "done", text: "hi" }];
    await runTurn(chat, "x", emit);
    const asstId = db.listMessages(chat.id)[1].id;
    frames = [];
    await editAndRerun(reload(chat.id), asstId, "nope", emit);
    const err = frames.find((f) => f.type === "error");
    expect(err && err.type === "error" && err.message).toMatch(/only user messages/i);
  });
});

describe("parsePlanSteps", () => {
  it("extracts numbered steps", () => {
    expect(parsePlanSteps("1. one\n2. two\n3. three")).toEqual(["one", "two", "three"]);
  });
  it("extracts dash-bulleted steps", () => {
    expect(parsePlanSteps("- alpha\n- beta")).toEqual(["alpha", "beta"]);
  });
  it("ignores prose lines that aren't list items", () => {
    expect(parsePlanSteps("Here is the plan:\n1. one\nfollowup line\n2. two")).toEqual(["one", "two"]);
  });
  it("strips leftover bold markers", () => {
    expect(parsePlanSteps("1. **Do** the thing")).toEqual(["Do the thing"]);
  });
  it("returns an empty list when nothing matches", () => {
    expect(parsePlanSteps("just prose with no list items")).toEqual([]);
  });
});
