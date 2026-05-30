import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = buildServer({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("HTTP API", () => {
  it("GET /api/health", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("GET /api/harnesses returns all three harnesses", async () => {
    const res = await app.inject({ method: "GET", url: "/api/harnesses" });
    expect(res.statusCode).toBe(200);
    const ids = res.json().map((h: { id: string }) => h.id).sort();
    expect(ids).toEqual(["claude", "hermes", "pi"]);
  });

  it("rejects creating a chat with an invalid harness", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/chats",
      payload: { harness: "bogus" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("creates, reads, patches and deletes a chat", async () => {
    // create
    const created = await app.inject({
      method: "POST",
      url: "/api/chats",
      payload: { harness: "claude", model: "sonnet", title: "Test chat" },
    });
    expect(created.statusCode).toBe(200);
    const chat = created.json();
    expect(chat.id).toBeTruthy();
    expect(chat.harness).toBe("claude");
    expect(chat.model).toBe("sonnet");
    expect(chat.config).toBeNull();

    // appears in list
    const list = await app.inject({ method: "GET", url: "/api/chats" });
    expect(list.json().some((c: { id: string }) => c.id === chat.id)).toBe(true);

    // get with messages
    const got = await app.inject({ method: "GET", url: `/api/chats/${chat.id}` });
    expect(got.statusCode).toBe(200);
    expect(got.json().messages).toEqual([]);

    // patch model + config (per-chat model selection + agents/skills)
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/chats/${chat.id}`,
      payload: { model: "opus", config: { agent: "reviewer", skills: ["pdf", "xlsx"] } },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().model).toBe("opus");
    expect(patched.json().config).toEqual({ agent: "reviewer", skills: ["pdf", "xlsx"] });

    // delete
    const del = await app.inject({ method: "DELETE", url: `/api/chats/${chat.id}` });
    expect(del.statusCode).toBe(200);
    const after = await app.inject({ method: "GET", url: `/api/chats/${chat.id}` });
    expect(after.statusCode).toBe(404);
  });

  it("PATCH on a missing chat is 404", async () => {
    const res = await app.inject({ method: "PATCH", url: "/api/chats/nope", payload: { model: "x" } });
    expect(res.statusCode).toBe(404);
  });

  it("switches the harness of an existing chat and clears the native session", async () => {
    const created = await app.inject({ method: "POST", url: "/api/chats", payload: { harness: "claude" } });
    const id = created.json().id;
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/chats/${id}`,
      payload: { harness: "hermes" },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().harness).toBe("hermes");
    expect(patched.json().harnessSessionId).toBeNull();
  });

  it("rejects switching to an invalid harness", async () => {
    const created = await app.inject({ method: "POST", url: "/api/chats", payload: { harness: "claude" } });
    const id = created.json().id;
    const res = await app.inject({ method: "PATCH", url: `/api/chats/${id}`, payload: { harness: "bogus" } });
    expect(res.statusCode).toBe(400);
  });

  it("gets and updates settings", async () => {
    const initial = await app.inject({ method: "GET", url: "/api/settings" });
    expect(initial.statusCode).toBe(200);
    expect(initial.json().defaultHarness).toBe("claude");

    const put = await app.inject({
      method: "PUT",
      url: "/api/settings",
      payload: { defaultHarness: "pi", models: { pi: "google/gemini" }, defaultConfig: { skills: ["x"] } },
    });
    expect(put.statusCode).toBe(200);

    const again = await app.inject({ method: "GET", url: "/api/settings" });
    expect(again.json().defaultHarness).toBe("pi");
    expect(again.json().models.pi).toBe("google/gemini");
  });

  it("rejects settings with an invalid defaultHarness", async () => {
    const res = await app.inject({ method: "PUT", url: "/api/settings", payload: { defaultHarness: "nope", models: {} } });
    expect(res.statusCode).toBe(400);
  });

  it("creates, lists, toggles and deletes a scheduled job", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/jobs",
      payload: { name: "Daily standup", harness: "claude", model: "sonnet", prompt: "Summarize today", schedule: "0 9 * * *" },
    });
    expect(created.statusCode).toBe(200);
    const job = created.json();
    expect(job.id).toBeTruthy();
    expect(job.enabled).toBe(true);
    expect(job.chatId).toBeTruthy(); // a dedicated chat was created

    const list = await app.inject({ method: "GET", url: "/api/jobs" });
    expect(list.json().some((j: { id: string }) => j.id === job.id)).toBe(true);

    const toggled = await app.inject({ method: "PATCH", url: `/api/jobs/${job.id}`, payload: { enabled: false } });
    expect(toggled.json().enabled).toBe(false);

    const del = await app.inject({ method: "DELETE", url: `/api/jobs/${job.id}` });
    expect(del.statusCode).toBe(200);
  });

  it("rejects a job with an unknown harness", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/jobs",
      payload: { name: "x", harness: "bogus", prompt: "x", schedule: "0 9 * * *" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a job with no prompt", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/jobs",
      payload: { name: "x", harness: "claude", prompt: "", schedule: "0 9 * * *" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a job with an invalid cron schedule", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/jobs",
      payload: { name: "Bad", harness: "claude", prompt: "x", schedule: "not a cron" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("distill without an Obsidian vault is a 400", async () => {
    const created = await app.inject({ method: "POST", url: "/api/chats", payload: { harness: "claude" } });
    const id = created.json().id;
    const res = await app.inject({ method: "POST", url: `/api/chats/${id}/distill` });
    expect(res.statusCode).toBe(400);
  });
});
