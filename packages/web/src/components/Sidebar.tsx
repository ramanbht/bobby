import { useEffect, useState } from "react";
import type { AppSettings, Chat, CreateChatRequest, HarnessId, HarnessInfo } from "@bobby/shared";
import { FlowerLogo } from "./FlowerLogo.js";

export function Sidebar({
  chats,
  harnesses,
  settings,
  activeId,
  connection,
  onSelect,
  onCreate,
  onDelete,
  onOpenSettings,
  onOpenJobs,
}: {
  chats: Chat[];
  harnesses: HarnessInfo[];
  settings: AppSettings | null;
  activeId: string | null;
  connection: string;
  onSelect: (id: string) => void;
  onCreate: (body: CreateChatRequest) => void;
  onDelete: (id: string) => void;
  onOpenSettings: () => void;
  onOpenJobs: () => void;
}) {
  const [creating, setCreating] = useState(false);

  return (
    <aside className="sidebar">
      <div className="brand">
        <FlowerLogo size={26} />
        <span className="brand-name">Bobby</span>
        <span className={`conn conn-${connection}`} title={`socket: ${connection}`} />
        <button className="icon-btn jobs-btn" onClick={onOpenJobs} title="Scheduled jobs">⏱</button>
        <button className="icon-btn settings-gear" onClick={onOpenSettings} title="Settings">⚙</button>
      </div>

      <button className="new-chat" onClick={() => setCreating((v) => !v)}>
        {creating ? "Cancel" : "+ New chat"}
      </button>

      {creating && (
        <NewChatForm
          harnesses={harnesses}
          settings={settings}
          onCreate={(body) => {
            onCreate(body);
            setCreating(false);
          }}
        />
      )}

      <nav className="chat-list">
        {chats.length === 0 && <p className="empty-hint">No chats yet.</p>}
        {chats.map((c) => (
          <div
            key={c.id}
            className={`chat-item ${c.id === activeId ? "active" : ""}`}
            onClick={() => onSelect(c.id)}
          >
            <div className="chat-item-main">
              <div className="chat-title">{c.title}</div>
              <div className="chat-meta">{c.harness}{c.model ? ` · ${c.model}` : ""}</div>
            </div>
            <button
              className="del-btn"
              title="Delete chat"
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Delete "${c.title}"?`)) onDelete(c.id);
              }}
            >
              ×
            </button>
          </div>
        ))}
      </nav>
    </aside>
  );
}

function NewChatForm({
  harnesses,
  settings,
  onCreate,
}: {
  harnesses: HarnessInfo[];
  settings: AppSettings | null;
  onCreate: (body: CreateChatRequest) => void;
}) {
  const fallback = harnesses.find((h) => h.available)?.id ?? harnesses[0]?.id ?? "claude";
  const initialHarness = settings?.defaultHarness ?? fallback;
  const [harness, setHarness] = useState<HarnessId>(initialHarness);
  const [model, setModel] = useState(settings?.models?.[initialHarness] ?? "");

  // When the harness changes, pre-fill its default model from settings.
  useEffect(() => {
    setModel(settings?.models?.[harness] ?? "");
  }, [harness, settings]);

  return (
    <div className="new-chat-form">
      <label>
        Harness
        <select value={harness} onChange={(e) => setHarness(e.target.value as HarnessId)}>
          {harnesses.map((h) => (
            <option key={h.id} value={h.id} disabled={!h.available}>
              {h.label}{h.available ? "" : " (not installed)"}
            </option>
          ))}
        </select>
      </label>
      <label>
        Model <span className="muted">(optional)</span>
        <input
          value={model}
          placeholder="harness default"
          onChange={(e) => setModel(e.target.value)}
        />
      </label>
      <button
        className="create-btn"
        onClick={() =>
          onCreate({
            harness,
            model: model.trim() || undefined,
            config: settings?.defaultConfig,
          })
        }
      >
        Create chat
      </button>
    </div>
  );
}
