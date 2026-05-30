import { useEffect, useRef, useState } from "react";
import type { ChatWithMessages, HarnessId, HarnessInfo, Message, UpdateChatRequest } from "@bobby/shared";
import { MessageContent } from "./MessageContent.js";
import { PlanCard } from "./PlanCard.js";
import { ReviewPane } from "./ReviewPane.js";

export function ChatPane({
  chat,
  harnesses,
  busy,
  obsidianConfigured,
  distillNote,
  onDistill,
  onPatch,
  onEditMessage,
  onReviewSubmit,
  onExecutePlan,
  onContinuePlan,
  onStop,
}: {
  chat: ChatWithMessages;
  harnesses: HarnessInfo[];
  busy: boolean;
  obsidianConfigured: boolean;
  distillNote: string | null;
  onDistill: () => void;
  onPatch: (patch: UpdateChatRequest) => void;
  onEditMessage: (messageId: string, text: string) => void;
  onReviewSubmit: (text: string) => void;
  onExecutePlan: (messageId: string) => void;
  onContinuePlan: (messageId: string) => void;
  onStop: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const reviewMessage = reviewId ? chat.messages.find((m) => m.id === reviewId) ?? null : null;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [chat.messages]);

  return (
    <section className="chat-pane">
      <header className="chat-header">
        <div className="chat-header-left">
          <div className="chat-header-title">{chat.title}</div>
          <div className="chat-header-meta">
            <select
              className="harness-select"
              value={chat.harness}
              title="Harness for this chat"
              onChange={(e) => onPatch({ harness: e.target.value as HarnessId })}
            >
              {harnesses.map((h) => (
                <option key={h.id} value={h.id} disabled={!h.available}>
                  {h.label}{h.available ? "" : " (not installed)"}
                </option>
              ))}
            </select>
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
            className={`distill-btn ${obsidianConfigured ? "" : "needs-setup"}`}
            title={
              obsidianConfigured
                ? "Distill this chat into an Obsidian note"
                : "No Obsidian vault yet — click for how to enable, or set one in Settings (⚙)"
            }
            onClick={onDistill}
          >
            ✦ Distill
          </button>
        </div>
      </header>

      {showConfig && <ConfigPanel chat={chat} onPatch={onPatch} />}
      {distillNote && <div className="distill-banner">{distillNote}</div>}

      <div className="chat-body">
        <div className="messages" ref={scrollRef}>
          {chat.messages.length === 0 && (
            <div className="empty-conv">Say something to {chat.harness}.</div>
          )}
          {chat.messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              busy={busy}
              onEdit={m.role === "user" ? (text) => onEditMessage(m.id, text) : undefined}
              onReview={m.role === "assistant" ? () => setReviewId(m.id) : undefined}
              onApprovePlan={() => onExecutePlan(m.id)}
              onContinuePlan={() => onContinuePlan(m.id)}
              onStop={onStop}
            />
          ))}
        </div>

        {reviewMessage && (
          <ReviewPane
            message={reviewMessage}
            onClose={() => setReviewId(null)}
            onSubmit={(text) => {
              setReviewId(null);
              onReviewSubmit(text);
            }}
          />
        )}
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

function MessageBubble({
  message,
  busy,
  onEdit,
  onReview,
  onApprovePlan,
  onContinuePlan,
  onStop,
}: {
  message: Message;
  busy: boolean;
  onEdit?: (text: string) => void;
  onReview?: () => void;
  onApprovePlan: () => void;
  onContinuePlan: () => void;
  onStop: () => void;
}) {
  const isUser = message.role === "user";
  const plan = message.meta?.plan;
  const streaming = !isUser && busy && message.content === "" && !plan;
  const canReview = !!onReview && !plan && !!message.content && !busy;
  const thinking = !isUser ? message.meta?.thinking : undefined;
  // Auto-expand reasoning while the harness is still thinking (no answer yet);
  // once text arrives it stays whatever the user last set it to.
  const activelyThinking = !!thinking && busy && message.content === "" && !plan;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [thinkingOpen, setThinkingOpen] = useState(false);

  useEffect(() => setDraft(message.content), [message.content]);
  useEffect(() => {
    if (activelyThinking) setThinkingOpen(true);
  }, [activelyThinking]);

  const startEdit = () => {
    setDraft(message.content);
    setEditing(true);
  };
  const saveEdit = () => {
    const text = draft.trim();
    setEditing(false);
    if (text && text !== message.content) onEdit?.(text);
  };

  return (
    <div className={`msg msg-${message.role}`}>
      <div className="msg-role">
        {isUser ? "You" : "Assistant"}
        {onEdit && !editing && !busy && (
          <button className="edit-btn" title="Edit & re-run from here" onClick={startEdit}>
            ✎ edit
          </button>
        )}
        {canReview && (
          <button className="edit-btn" title="Review & leave inline comments" onClick={onReview}>
            📝 review
          </button>
        )}
      </div>
      <div className="msg-body">
        {editing ? (
          <div className="msg-edit">
            <textarea
              className="msg-edit-input"
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveEdit();
                if (e.key === "Escape") setEditing(false);
              }}
            />
            <div className="msg-edit-actions">
              <span className="muted">⌘↵ to save & re-run</span>
              <button className="ghost-btn" onClick={() => setEditing(false)}>Cancel</button>
              <button className="primary-btn" onClick={saveEdit}>Save &amp; re-run</button>
            </div>
          </div>
        ) : plan ? (
          <PlanCard
            plan={plan}
            onApprove={onApprovePlan}
            onContinue={onContinuePlan}
            onStop={onStop}
          />
        ) : (
          <>
            {thinking && (
              <details
                className="thinking"
                open={thinkingOpen}
                onToggle={(e) => setThinkingOpen((e.target as HTMLDetailsElement).open)}
              >
                <summary>
                  💭 Thinking{activelyThinking ? "…" : ""}
                </summary>
                <div className="thinking-body">
                  <MessageContent text={thinking} />
                </div>
              </details>
            )}
            <MessageContent text={message.content} />
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
          </>
        )}
      </div>
    </div>
  );
}

