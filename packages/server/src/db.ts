import Database from "better-sqlite3";
import { v4 as uuid } from "uuid";
import type {
  AppSettings,
  Chat,
  ChatConfig,
  ChatWithMessages,
  HarnessId,
  Message,
  MessageMeta,
  Role,
  UpdateChatRequest,
} from "@bobby/shared";
import { DEFAULT_SETTINGS } from "@bobby/shared";
import { config, ensureDirs } from "./config.js";

ensureDirs();

const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS chats (
    id                 TEXT PRIMARY KEY,
    title              TEXT NOT NULL,
    harness            TEXT NOT NULL,
    model              TEXT,
    config             TEXT,
    harness_session_id TEXT,
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id         TEXT PRIMARY KEY,
    chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role       TEXT NOT NULL,
    content    TEXT NOT NULL,
    meta       TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at);

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Lightweight migrations for databases created before a column existed.
function ensureColumn(table: string, column: string, decl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${decl}`);
  }
}
ensureColumn("chats", "config", "config TEXT");

const now = () => new Date().toISOString();

/* ---- row mappers ---- */

interface ChatRow {
  id: string;
  title: string;
  harness: string;
  model: string | null;
  config: string | null;
  harness_session_id: string | null;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  chat_id: string;
  role: string;
  content: string;
  meta: string | null;
  created_at: string;
}

function toChat(r: ChatRow): Chat {
  return {
    id: r.id,
    title: r.title,
    harness: r.harness as HarnessId,
    model: r.model,
    config: r.config ? (JSON.parse(r.config) as ChatConfig) : null,
    harnessSessionId: r.harness_session_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toMessage(r: MessageRow): Message {
  return {
    id: r.id,
    chatId: r.chat_id,
    role: r.role as Role,
    content: r.content,
    meta: r.meta ? (JSON.parse(r.meta) as MessageMeta) : null,
    createdAt: r.created_at,
  };
}

/* ---- prepared statements ---- */

const stmt = {
  insertChat: db.prepare(
    `INSERT INTO chats (id, title, harness, model, config, harness_session_id, created_at, updated_at)
     VALUES (@id, @title, @harness, @model, @config, @harness_session_id, @created_at, @updated_at)`,
  ),
  listChats: db.prepare(`SELECT * FROM chats ORDER BY updated_at DESC`),
  getChat: db.prepare(`SELECT * FROM chats WHERE id = ?`),
  touchChat: db.prepare(`UPDATE chats SET updated_at = @updated_at WHERE id = @id`),
  setSession: db.prepare(
    `UPDATE chats SET harness_session_id = @sid, updated_at = @updated_at WHERE id = @id`,
  ),
  setTitle: db.prepare(`UPDATE chats SET title = @title, updated_at = @updated_at WHERE id = @id`),
  updateChatFields: db.prepare(
    `UPDATE chats SET title = @title, model = @model, config = @config, updated_at = @updated_at WHERE id = @id`,
  ),
  deleteChat: db.prepare(`DELETE FROM chats WHERE id = ?`),
  getSetting: db.prepare(`SELECT value FROM settings WHERE key = ?`),
  setSetting: db.prepare(
    `INSERT INTO settings (key, value) VALUES (@key, @value)
     ON CONFLICT(key) DO UPDATE SET value = @value`,
  ),
  insertMessage: db.prepare(
    `INSERT INTO messages (id, chat_id, role, content, meta, created_at)
     VALUES (@id, @chat_id, @role, @content, @meta, @created_at)`,
  ),
  updateMessage: db.prepare(
    `UPDATE messages SET content = @content, meta = @meta WHERE id = @id`,
  ),
  listMessages: db.prepare(`SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC`),
  getMessage: db.prepare(`SELECT * FROM messages WHERE id = ?`),
};

/* ---- public API ---- */

export function createChat(input: {
  title?: string;
  harness: HarnessId;
  model?: string;
  config?: ChatConfig;
}): Chat {
  const ts = now();
  const chat: ChatRow = {
    id: uuid(),
    title: input.title?.trim() || "New chat",
    harness: input.harness,
    model: input.model ?? null,
    config: input.config ? JSON.stringify(input.config) : null,
    harness_session_id: null,
    created_at: ts,
    updated_at: ts,
  };
  stmt.insertChat.run(chat);
  return toChat(chat);
}

/** Apply a partial update to a chat's title/model/config. Returns the updated chat. */
export function updateChat(id: string, patch: UpdateChatRequest): Chat | null {
  const current = getChat(id);
  if (!current) return null;
  const title = patch.title?.trim() || current.title;
  const model = patch.model !== undefined ? patch.model : current.model;
  const config = patch.config !== undefined ? patch.config : current.config;
  stmt.updateChatFields.run({
    id,
    title,
    model: model ?? null,
    config: config ? JSON.stringify(config) : null,
    updated_at: now(),
  });
  return getChat(id);
}

export function listChats(): Chat[] {
  return (stmt.listChats.all() as ChatRow[]).map(toChat);
}

export function getChat(id: string): Chat | null {
  const row = stmt.getChat.get(id) as ChatRow | undefined;
  return row ? toChat(row) : null;
}

export function getChatWithMessages(id: string): ChatWithMessages | null {
  const chat = getChat(id);
  if (!chat) return null;
  return { ...chat, messages: listMessages(id) };
}

export function listMessages(chatId: string): Message[] {
  return (stmt.listMessages.all(chatId) as MessageRow[]).map(toMessage);
}

export function deleteChat(id: string): void {
  stmt.deleteChat.run(id);
}

export function setHarnessSession(chatId: string, sessionId: string): void {
  stmt.setSession.run({ id: chatId, sid: sessionId, updated_at: now() });
}

export function renameChat(chatId: string, title: string): void {
  stmt.setTitle.run({ id: chatId, title, updated_at: now() });
}

export function addMessage(input: {
  chatId: string;
  role: Role;
  content: string;
  meta?: MessageMeta | null;
}): Message {
  const ts = now();
  const row: MessageRow = {
    id: uuid(),
    chat_id: input.chatId,
    role: input.role,
    content: input.content,
    meta: input.meta ? JSON.stringify(input.meta) : null,
    created_at: ts,
  };
  stmt.insertMessage.run(row);
  stmt.touchChat.run({ id: input.chatId, updated_at: ts });
  return toMessage(row);
}

export function updateMessage(
  id: string,
  content: string,
  meta?: MessageMeta | null,
): Message {
  stmt.updateMessage.run({ id, content, meta: meta ? JSON.stringify(meta) : null });
  return toMessage(stmt.getMessage.get(id) as MessageRow);
}

/* ---- settings ---- */

const SETTINGS_KEY = "app";

export function getSettings(): AppSettings {
  const row = stmt.getSetting.get(SETTINGS_KEY) as { value: string } | undefined;
  if (!row) return DEFAULT_SETTINGS;
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(row.value) as Partial<AppSettings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): AppSettings {
  const merged: AppSettings = { ...DEFAULT_SETTINGS, ...settings };
  stmt.setSetting.run({ key: SETTINGS_KEY, value: JSON.stringify(merged) });
  return merged;
}
