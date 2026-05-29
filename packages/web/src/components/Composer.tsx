import { useState, type KeyboardEvent } from "react";

export function Composer({
  disabled,
  busy,
  onSend,
}: {
  disabled: boolean;
  busy: boolean;
  onSend: (text: string) => void;
}) {
  const [text, setText] = useState("");

  const submit = () => {
    const t = text.trim();
    if (!t || disabled) return;
    onSend(t);
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
      <textarea
        value={text}
        placeholder={disabled ? "Select or create a chat to begin…" : "Message your harness…  (Enter to send, Shift+Enter for newline)"}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        disabled={disabled}
        rows={1}
      />
      <button className="send-btn" onClick={submit} disabled={disabled || !text.trim()}>
        {busy ? "…" : "Send"}
      </button>
    </div>
  );
}
