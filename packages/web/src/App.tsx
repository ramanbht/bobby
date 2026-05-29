import { useCallback, useEffect, useState } from "react";
import type {
  AppSettings,
  Chat,
  ChatWithMessages,
  CreateChatRequest,
  HarnessEvent,
  HarnessInfo,
  Message,
  ServerConfigInfo,
  ServerFrame,
  UpdateChatRequest,
} from "@bobby/shared";
import { api } from "./api.js";
import { useChatSocket } from "./useChatSocket.js";
import { Sidebar } from "./components/Sidebar.js";
import { ChatPane } from "./components/ChatPane.js";
import { Composer } from "./components/Composer.js";
import { SettingsModal } from "./components/SettingsModal.js";
import { FlowerLogo } from "./components/FlowerLogo.js";

export function App() {
  const [harnesses, setHarnesses] = useState<HarnessInfo[]>([]);
  const [serverConfig, setServerConfig] = useState<ServerConfigInfo | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [chats, setChats] = useState<Chat[]>([]);
  const [active, setActive] = useState<ChatWithMessages | null>(null);
  const [busy, setBusy] = useState(false);
  const [distillNote, setDistillNote] = useState<string | null>(null);

  const activeId = active?.id ?? null;

  /* ---- initial load ---- */
  useEffect(() => {
    api.listHarnesses().then(setHarnesses).catch(console.error);
    api.getConfig().then(setServerConfig).catch(console.error);
    api.getSettings().then(setSettings).catch(console.error);
    api.listChats().then(setChats).catch(console.error);
  }, []);

  /* ---- streaming frame handler ---- */
  const onFrame = useCallback(
    (frame: ServerFrame) => {
      setActive((cur) => {
        if (!cur) return cur;
        switch (frame.type) {
          case "user-message":
            if (frame.message.chatId !== cur.id) return cur;
            return { ...cur, messages: [...cur.messages, frame.message] };
          case "turn-start": {
            if (frame.chatId !== cur.id) return cur;
            const placeholder: Message = {
              id: frame.messageId,
              chatId: cur.id,
              role: "assistant",
              content: "",
              meta: null,
              createdAt: new Date().toISOString(),
            };
            return { ...cur, messages: [...cur.messages, placeholder] };
          }
          case "event": {
            if (frame.chatId !== cur.id) return cur;
            return { ...cur, messages: cur.messages.map((m) => applyEvent(m, frame.messageId, frame.event)) };
          }
          case "turn-end": {
            if (frame.chatId !== cur.id) return cur;
            setBusy(false);
            return {
              ...cur,
              messages: cur.messages.map((m) => (m.id === frame.message.id ? frame.message : m)),
            };
          }
          case "error":
            setBusy(false);
            return cur;
        }
      });

      if (frame.type === "turn-end" || frame.type === "user-message") {
        // Reflect title/updatedAt changes in the sidebar.
        api.listChats().then(setChats).catch(() => {});
      }
    },
    [],
  );

  const { status, send } = useChatSocket(onFrame);

  /* ---- actions ---- */
  const selectChat = async (id: string) => {
    setDistillNote(null);
    const chat = await api.getChat(id);
    setActive(chat);
  };

  const createChat = async (body: CreateChatRequest) => {
    const chat = await api.createChat(body);
    setChats((cs) => [chat, ...cs]);
    setActive({ ...chat, messages: [] });
  };

  const deleteChat = async (id: string) => {
    await api.deleteChat(id);
    setChats((cs) => cs.filter((c) => c.id !== id));
    if (activeId === id) setActive(null);
  };

  const patchChat = async (patch: UpdateChatRequest) => {
    if (!active) return;
    const updated = await api.updateChat(active.id, patch);
    setActive((cur) => (cur && cur.id === updated.id ? { ...cur, ...updated } : cur));
    setChats((cs) => cs.map((c) => (c.id === updated.id ? updated : c)));
  };

  const saveSettings = async (s: AppSettings) => {
    const saved = await api.saveSettings(s);
    setSettings(saved);
  };

  const sendMessage = (text: string) => {
    if (!active) return;
    setBusy(true);
    send(active.id, text);
  };

  const distill = async () => {
    if (!active) return;
    setDistillNote("Distilling…");
    try {
      const res = await api.distill(active.id);
      setDistillNote(
        res.distilled
          ? `✦ Saved note: ${res.noteTitle}`
          : `Nothing worth saving (${"reason" in res ? res.reason : ""}).`,
      );
    } catch (e) {
      setDistillNote(`Distill failed: ${(e as Error).message}`);
    }
  };

  return (
    <div className="app">
      <Sidebar
        chats={chats}
        harnesses={harnesses}
        settings={settings}
        activeId={activeId}
        connection={status}
        onSelect={selectChat}
        onCreate={createChat}
        onDelete={deleteChat}
        onOpenSettings={() => setShowSettings(true)}
      />
      <main className="main">
        {active ? (
          <>
            <ChatPane
              chat={active}
              busy={busy}
              obsidianConfigured={!!serverConfig?.obsidianConfigured}
              distillNote={distillNote}
              onDistill={distill}
              onPatch={patchChat}
            />
            <Composer disabled={false} busy={busy} onSend={sendMessage} />
          </>
        ) : (
          <Welcome harnesses={harnesses} />
        )}
      </main>

      {showSettings && settings && (
        <SettingsModal
          settings={settings}
          harnesses={harnesses}
          onClose={() => setShowSettings(false)}
          onSave={saveSettings}
        />
      )}
    </div>
  );
}

function applyEvent(m: Message, messageId: string, event: HarnessEvent): Message {
  if (m.id !== messageId) return m;
  const meta = m.meta ? { ...m.meta } : {};
  switch (event.type) {
    case "text-delta":
      return { ...m, content: m.content + event.text };
    case "text":
      return { ...m, content: event.text };
    case "thinking-delta":
      return { ...m, meta: { ...meta, thinking: (meta.thinking ?? "") + event.text } };
    case "tool-use":
      return {
        ...m,
        meta: { ...meta, toolCalls: [...(meta.toolCalls ?? []), { id: event.id, name: event.name, input: event.input }] },
      };
    case "tool-result":
      return {
        ...m,
        meta: { ...meta, toolResults: [...(meta.toolResults ?? []), { id: event.id, output: event.output, isError: event.isError }] },
      };
    default:
      return m;
  }
}

function Welcome({ harnesses }: { harnesses: HarnessInfo[] }) {
  return (
    <div className="welcome">
      <FlowerLogo size={72} />
      <h1>Bobby</h1>
      <p>One chat dashboard over your local LLM harnesses.</p>
      <div className="welcome-harnesses">
        {harnesses.map((h) => (
          <span key={h.id} className={`badge ${h.available ? "" : "badge-dim"}`}>
            {h.label} {h.available ? "✓" : "—"}
          </span>
        ))}
      </div>
      <p className="muted">Create a new chat to begin.</p>
    </div>
  );
}
