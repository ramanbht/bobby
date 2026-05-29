import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ChatWithMessages, Message, UpdateChatRequest } from "@bobby/shared";

export function ChatPane({
  chat,
  busy,
  obsidianConfigured,
  distillNote,
  onDistill,
  onPatch,
}: {
  chat: ChatWithMessages;
  busy: boolean;
  obsidianConfigured: boolean;
  distillNote: string | null;
  onDistill: () => void;
  onPatch: (patch: UpdateChatRequest) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showConfig, setShowConfig] = useState(false);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [chat.messages]);

  return (
    <section className="chat-pane">
      <header className="chat-header">
        <div className="chat-header-left">
          <div className="chat-header-title">{chat.title}</div>
          <div className="chat-header-meta">
            <span className="badge">{chat.harness}</span>
          </div>
        </div>

        <div className="chat-header-right">
          <ModelInput chat={chat} onPatch={onPatch} />
          <button
            className={`icon-btn ${showConfig ? "active" : ""}`}
            title="Agents & skills"
            onClick={() => setShowConfig((v) => !v)}
          >
            ⚙
          </button>
          <button
            className="distill-btn"
            disabled={!obsidianConfigured}
            title={obsidianConfigured ? "Distill this chat into an Obsidian note" : "Set OBSIDIAN_VAULT to enable"}
            onClick={onDistill}
          >
            ✦ Distill
          </button>
        </div>
      </header>

      {showConfig && <ConfigPanel chat={chat} onPatch={onPatch} />}
      {distillNote && <div className="distill-banner">{distillNote}</div>}

      <div className="messages" ref={scrollRef}>
        {chat.messages.length === 0 && (
          <div className="empty-conv">Say something to {chat.harness}.</div>
        )}
        {chat.messages.map((m) => (
          <MessageBubble key={m.id} message={m} busy={busy} />
        ))}
      </div>
    </section>
  );
}

/** Inline, always-visible per-chat model selector (commits on Enter / blur). */
function ModelInput({ chat, onPatch }: { chat: ChatWithMessages; onPatch: (p: UpdateChatRequest) => void }) {
  const [model, setModel] = useState(chat.model ?? "");
  useEffect(() => setModel(chat.model ?? ""), [chat.id, chat.model]);

  const commit = () => {
    const next = model.trim();
    if (next !== (chat.model ?? "")) onPatch({ model: next || null });
  };

  return (
    <input
      className="model-input"
      value={model}
      placeholder="model"
      title="Model for this chat"
      onChange={(e) => setModel(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

/** Per-chat advanced config: custom agent + agents JSON (Claude) and skills (Hermes/pi). */
function ConfigPanel({ chat, onPatch }: { chat: ChatWithMessages; onPatch: (p: UpdateChatRequest) => void }) {
  const [agent, setAgent] = useState(chat.config?.agent ?? "");
  const [agentsJson, setAgentsJson] = useState(chat.config?.agentsJson ?? "");
  const [skills, setSkills] = useState((chat.config?.skills ?? []).join(", "));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setAgent(chat.config?.agent ?? "");
    setAgentsJson(chat.config?.agentsJson ?? "");
    setSkills((chat.config?.skills ?? []).join(", "));
    setJsonError(null);
  }, [chat.id]);

  const save = () => {
    if (agentsJson.trim()) {
      try {
        JSON.parse(agentsJson);
      } catch {
        setJsonError("Agents JSON is not valid JSON.");
        return;
      }
    }
    setJsonError(null);
    onPatch({
      config: {
        agent: agent.trim() || undefined,
        agentsJson: agentsJson.trim() || undefined,
        skills: skills.split(",").map((s) => s.trim()).filter(Boolean),
      },
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="config-panel">
      <label className="field">
        <span>Agent <span className="muted">(Claude · --agent)</span></span>
        <input value={agent} placeholder="e.g. reviewer" onChange={(e) => setAgent(e.target.value)} />
      </label>
      <label className="field">
        <span>Custom agents JSON <span className="muted">(Claude · --agents)</span></span>
        <textarea
          value={agentsJson}
          rows={3}
          spellCheck={false}
          placeholder={'{"reviewer": {"description": "Reviews code", "prompt": "You are a reviewer"}}'}
          onChange={(e) => setAgentsJson(e.target.value)}
        />
      </label>
      <label className="field">
        <span>Skills <span className="muted">(comma-separated · Hermes &amp; pi)</span></span>
        <input value={skills} placeholder="e.g. pdf, xlsx" onChange={(e) => setSkills(e.target.value)} />
      </label>
      {jsonError && <div className="config-error">{jsonError}</div>}
      <div className="config-actions">
        <button className="primary-btn" onClick={save}>{saved ? "Saved ✓" : "Apply"}</button>
      </div>
    </div>
  );
}

function MessageBubble({ message, busy }: { message: Message; busy: boolean }) {
  const isUser = message.role === "user";
  const streaming = !isUser && busy && message.content === "";
  return (
    <div className={`msg msg-${message.role}`}>
      <div className="msg-role">{isUser ? "You" : "Assistant"}</div>
      <div className="msg-body">
        {renderContent(message.content)}
        {streaming && <span className="cursor">▋</span>}
        {message.meta?.toolCalls?.length ? (
          <div className="tool-note">
            🔧 used {message.meta.toolCalls.length} tool
            {message.meta.toolCalls.length > 1 ? "s" : ""}: {message.meta.toolCalls.map((t) => t.name).join(", ")}
          </div>
        ) : null}
        {message.meta?.usage?.costUsd != null && (
          <div className="usage-note">${message.meta.usage.costUsd.toFixed(4)}</div>
        )}
      </div>
    </div>
  );
}

/** Minimal renderer: fenced code blocks become <pre>; prose gets inline markdown. */
function renderContent(text: string): ReactNode {
  if (!text) return null;
  const parts = text.split(/```/);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <pre key={i} className="code-block">
        <code>{part.replace(/^[\w-]*\n/, "")}</code>
      </pre>
    ) : (
      <span key={i} className="prose">
        {renderInline(part)}
      </span>
    ),
  );
}

/** Inline markdown: **bold**, *italic*, `code`. Newlines/lists are preserved by the
 *  parent's `white-space: pre-wrap`, so we only need to tokenize emphasis here. */
function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) nodes.push(<strong key={k++}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) nodes.push(<code key={k++} className="inline-code">{tok.slice(1, -1)}</code>);
    else nodes.push(<em key={k++}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}
