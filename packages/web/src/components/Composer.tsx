import { useState, type KeyboardEvent } from "react";

export function Composer({
  disabled,
  busy,
  harnessLabel,
  onSend,
  onPlan,
  onStop,
}: {
  disabled: boolean;
  busy: boolean;
  harnessLabel: string;
  onSend: (text: string) => void;
  onPlan: (text: string) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState("");
  const [planFirst, setPlanFirst] = useState(false);

  const submit = () => {
    const t = text.trim();
    if (!t || disabled) return;
    if (planFirst) onPlan(t);
    else onSend(t);
    setText("");
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="composer">
      <button
        type="button"
        className={`plan-toggle ${planFirst ? "on" : ""}`}
        title="Plan first: propose a step-by-step plan to review before running"
        onClick={() => setPlanFirst((v) => !v)}
        disabled={disabled}
      >
        ◆ Plan first
      </button>
      <textarea
        value={text}
        placeholder={
          disabled
            ? "Select or create a chat to begin…"
            : planFirst
              ? `Describe a task — ${harnessLabel} will propose a plan to review…`
              : `Message ${harnessLabel}…  (Enter to send, Shift+Enter for newline)`
        }
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        disabled={disabled}
        rows={1}
      />
      {busy ? (
        <button
          type="button"
          className="stop-btn"
          title="Stop the harness and keep whatever it has produced so far"
          onClick={onStop}
        >
          ■ Stop
        </button>
      ) : (
        <button className="send-btn" onClick={submit} disabled={disabled || !text.trim()}>
          {planFirst ? "Plan" : "Send"}
        </button>
      )}
    </div>
  );
}
