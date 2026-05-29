import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import type {
  AppSettings,
  ClientCommand,
  CreateChatRequest,
  ServerFrame,
  UpdateChatRequest,
} from "@bobby/shared";
import { HARNESSES } from "@bobby/shared";
import { config } from "./config.js";
import * as db from "./db.js";
import { distillChat } from "./memory/distill.js";
import { listHarnessInfo } from "./harness-info.js";
import { runTurn } from "./turn.js";

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
    obsidianConfigured: !!config.obsidianVault,
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
      const updated = db.updateChat(req.params.id, req.body ?? {});
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
    if (!config.obsidianVault) {
      return reply.code(400).send({ error: "Obsidian vault not configured (set OBSIDIAN_VAULT)." });
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

      if (cmd.type === "send") {
        const chat = db.getChat(cmd.chatId);
        if (!chat) {
          emit({ type: "error", chatId: cmd.chatId, message: "chat not found" });
          return;
        }
        if (!cmd.text?.trim()) {
          emit({ type: "error", chatId: cmd.chatId, message: "empty message" });
          return;
        }
        chain = chain
          .then(() => runTurn(chat, cmd.text, emit))
          .catch((err) => emit({ type: "error", chatId: cmd.chatId, message: (err as Error).message }));
      }
    });
  });
}
