import fs from "node:fs";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import fstatic from "@fastify/static";
import websocket from "@fastify/websocket";
import type {
  AppSettings,
  ClientCommand,
  CreateChatRequest,
  CreateJobRequest,
  ServerFrame,
  UpdateChatRequest,
  UpdateJobRequest,
} from "@bobby/shared";
import { HARNESSES } from "@bobby/shared";
import { config } from "./config.js";
import * as db from "./db.js";
import { distillChat } from "./memory/distill.js";
import { listHarnessInfo } from "./harness-info.js";
import { continuePlan, editAndRerun, executePlan, runPlan, runTurn, stopChat } from "./turn.js";
import {
  isValidSchedule,
  runJobNow,
  scheduleJob,
  setJobBroadcaster,
  unscheduleJob,
} from "./scheduler.js";

/** Every connected websocket, so scheduled-job output can be broadcast to open chats. */
const sockets = new Set<{ readyState: number; send: (d: string) => void }>();
function broadcast(frame: ServerFrame): void {
  const data = JSON.stringify(frame);
  for (const ws of sockets) {
    try {
      if (ws.readyState === 1) ws.send(data);
    } catch {
      /* dropped client */
    }
  }
}
setJobBroadcaster(broadcast);

export function buildServer(opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger === false ? false : { level: "info" } });

  app.register(cors, { origin: true });
  app.register(websocket);

  // Routes live in an encapsulated plugin registered *after* @fastify/websocket
  // so the plugin's onRoute hook is active when the /ws route is added.
  app.register(routes);

  return app;
}

async function routes(app: FastifyInstance) {
  /* ---------------- meta ---------------- */

  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/harnesses", async () => listHarnessInfo());

  app.get("/api/config", async () => ({
    obsidianConfigured: !!db.effectiveObsidianVault(),
    distillHarness: config.distillHarness,
    autoDistill: config.autoDistill,
  }));

  /* ---------------- settings ---------------- */

  app.get("/api/settings", async () => db.getSettings());

  app.put<{ Body: AppSettings }>("/api/settings", async (req, reply) => {
    const body = req.body;
    if (!body || !HARNESSES.includes(body.defaultHarness)) {
      return reply.code(400).send({ error: `defaultHarness must be one of ${HARNESSES.join(", ")}` });
    }
    return db.saveSettings(body);
  });

  /* ---------------- chats ---------------- */

  app.get("/api/chats", async () => db.listChats());

  app.post<{ Body: CreateChatRequest }>("/api/chats", async (req, reply) => {
    const { harness, title, model } = req.body ?? ({} as CreateChatRequest);
    if (!harness || !HARNESSES.includes(harness)) {
      return reply.code(400).send({ error: `harness must be one of ${HARNESSES.join(", ")}` });
    }
    return db.createChat({ harness, title, model, config: req.body?.config });
  });

  app.get<{ Params: { id: string } }>("/api/chats/:id", async (req, reply) => {
    const chat = db.getChatWithMessages(req.params.id);
    if (!chat) return reply.code(404).send({ error: "chat not found" });
    return chat;
  });

  app.patch<{ Params: { id: string }; Body: UpdateChatRequest }>(
    "/api/chats/:id",
    async (req, reply) => {
      const patch = req.body ?? {};
      if (patch.harness && !HARNESSES.includes(patch.harness)) {
        return reply.code(400).send({ error: `harness must be one of ${HARNESSES.join(", ")}` });
      }
      const updated = db.updateChat(req.params.id, patch);
      if (!updated) return reply.code(404).send({ error: "chat not found" });
      return updated;
    },
  );

  app.delete<{ Params: { id: string } }>("/api/chats/:id", async (req, reply) => {
    if (!db.getChat(req.params.id)) return reply.code(404).send({ error: "chat not found" });
    db.deleteChat(req.params.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/api/chats/:id/distill", async (req, reply) => {
    const chat = db.getChat(req.params.id);
    if (!chat) return reply.code(404).send({ error: "chat not found" });
    if (!db.effectiveObsidianVault()) {
      return reply
        .code(400)
        .send({ error: "Obsidian vault not configured (set it in Settings or OBSIDIAN_VAULT)." });
    }
    try {
      const result = await distillChat(chat, db.listMessages(chat.id));
      if (!result) return reply.code(200).send({ distilled: false, reason: "nothing worth saving" });
      return { distilled: true, ...result };
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  /* ---------------- streaming turns over WS ---------------- */

  app.get("/ws", { websocket: true }, (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    const emit = (frame: ServerFrame) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(frame));
    };

    // Serialize turns per connection so messages don't interleave.
    let chain: Promise<void> = Promise.resolve();

    socket.on("message", (raw: Buffer) => {
      let cmd: ClientCommand;
      try {
        cmd = JSON.parse(raw.toString());
      } catch {
        emit({ type: "error", message: "invalid JSON command" });
        return;
      }

      // Stop is immediate (not queued behind the running turn).
      if (cmd.type === "stop") {
        stopChat(cmd.chatId);
        return;
      }

      const chat = db.getChat(cmd.chatId);
      if (!chat) {
        emit({ type: "error", chatId: cmd.chatId, message: "chat not found" });
        return;
      }

      let run: (() => Promise<void>) | null = null;
      if (cmd.type === "send") {
        if (!cmd.text?.trim()) return emit({ type: "error", chatId: cmd.chatId, message: "empty message" });
        run = () => runTurn(chat, cmd.text, emit);
      } else if (cmd.type === "edit") {
        if (!cmd.text?.trim()) return emit({ type: "error", chatId: cmd.chatId, message: "empty message" });
        run = () => editAndRerun(chat, cmd.messageId, cmd.text, emit);
      } else if (cmd.type === "plan") {
        if (!cmd.text?.trim()) return emit({ type: "error", chatId: cmd.chatId, message: "empty message" });
        run = () => runPlan(chat, cmd.text, emit);
      } else if (cmd.type === "execute-plan") {
        run = () => executePlan(chat, cmd.messageId, emit);
      } else if (cmd.type === "continue-plan") {
        run = () => continuePlan(chat, cmd.messageId, emit);
      }
      if (run) {
        chain = chain
          .then(run)
          .catch((err) => emit({ type: "error", chatId: cmd.chatId, message: (err as Error).message }));
      }
    });
  });

  /* ---------------- scheduled jobs ---------------- */

  app.get("/api/jobs", async () => db.listJobs());

  app.post<{ Body: CreateJobRequest }>("/api/jobs", async (req, reply) => {
    const b = req.body ?? ({} as CreateJobRequest);
    if (!b.harness || !HARNESSES.includes(b.harness)) {
      return reply.code(400).send({ error: `harness must be one of ${HARNESSES.join(", ")}` });
    }
    if (!b.prompt?.trim()) return reply.code(400).send({ error: "prompt is required" });
    if (!b.schedule || !isValidSchedule(b.schedule)) {
      return reply.code(400).send({ error: "schedule must be a valid cron expression (e.g. '0 9 * * *')" });
    }
    // Each job gets a dedicated chat where its runs are recorded.
    const chat = db.createChat({ harness: b.harness, title: b.name?.trim() || "Scheduled job", model: b.model });
    const job = db.createJob({ ...b, chatId: chat.id });
    scheduleJob(job);
    return job;
  });

  app.patch<{ Params: { id: string }; Body: UpdateJobRequest }>("/api/jobs/:id", async (req, reply) => {
    const patch = req.body ?? {};
    if (patch.schedule && !isValidSchedule(patch.schedule)) {
      return reply.code(400).send({ error: "schedule must be a valid cron expression" });
    }
    const job = db.updateJob(req.params.id, patch);
    if (!job) return reply.code(404).send({ error: "job not found" });
    scheduleJob(job); // reschedule with fresh values (or unschedule if now disabled)
    return job;
  });

  app.delete<{ Params: { id: string } }>("/api/jobs/:id", async (req, reply) => {
    const job = db.getJob(req.params.id);
    if (!job) return reply.code(404).send({ error: "job not found" });
    unscheduleJob(job.id);
    db.deleteJob(job.id);
    db.deleteChat(job.chatId);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/api/jobs/:id/run", async (req, reply) => {
    const job = db.getJob(req.params.id);
    if (!job) return reply.code(404).send({ error: "job not found" });
    runJobNow(job).catch(() => {}); // fire-and-forget; output streams to open clients
    return { ok: true };
  });

  /* ---------------- static web UI (single origin; used by `pnpm start` + desktop) ---------------- */

  if (fs.existsSync(config.webDist)) {
    await app.register(fstatic, { root: config.webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      // API/WS misses stay JSON 404; any other GET falls back to the SPA shell.
      if (req.method !== "GET" || req.url.startsWith("/api") || req.url.startsWith("/ws")) {
        return reply.code(404).send({ error: "not found" });
      }
      return reply.sendFile("index.html");
    });
  }
}
