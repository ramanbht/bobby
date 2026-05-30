import { useMemo, useState } from "react";
import type { Message } from "@bobby/shared";
import { renderInline } from "./MessageContent.js";

/**
 * A side drawer for reviewing an assistant message line-by-line. Click any line
 * to attach an inline comment; "Send revision" collects every comment into one
 * follow-up message and hands it back to the harness as the next turn.
 */
export function ReviewPane({
  message,
  onSubmit,
  onClose,
}: {
  message: Message;
  onSubmit: (revision: string) => void;
  onClose: () => void;
}) {
  const lines = useMemo(() => message.content.split("\n"), [message.content]);
  // line index -> comment text. Presence of a key means the comment box is open.
  const [drafts, setDrafts] = useState<Record<number, string>>({});

  const commentCount = Object.values(drafts).filter((c) => c.trim()).length;

  const addComment = (i: number) => setDrafts((d) => (i in d ? d : { ...d, [i]: "" }));
  const setComment = (i: number, v: string) => setDrafts((d) => ({ ...d, [i]: v }));
  const removeComment = (i: number) =>
    setDrafts((d) => {
      const next = { ...d };
      delete next[i];
      return next;
    });

  const submit = () => {
    const entries = lines
      .map((line, i) => ({ line: line.trim(), comment: (drafts[i] ?? "").trim() }))
      .filter((e) => e.comment);
    if (!entries.length) return;
    const body = entries
      .map((e) => `> ${e.line || "(blank line)"}\n— ${e.comment}`)
      .join("\n\n");
    onSubmit(
      "Please revise your previous response based on these inline comments:\n\n" + body,
    );
  };

  return (
    <aside className="review-drawer">
      <header className="review-header">
        <div>
          <div className="review-title">Review &amp; comment</div>
          <div className="muted review-sub">
            Click a line to comment, then send your revision to the harness.
          </div>
        </div>
        <button className="icon-btn" title="Close review" onClick={onClose}>
          ×
        </button>
      </header>

      <div className="review-lines">
        {lines.map((line, i) => {
          const blank = line.trim() === "";
          const open = i in drafts;
          return (
            <div key={i} className={`review-line ${open ? "commented" : ""}`}>
              <button
                className="review-line-text"
                title={blank ? "" : "Comment on this line"}
                onClick={() => !blank && addComment(i)}
                disabled={blank}
              >
                {blank ? <span className="review-blank">·</span> : renderInline(line)}
              </button>
              {open && (
                <div className="review-comment">
                  <textarea
                    autoFocus
                    rows={2}
                    placeholder="Your comment…"
                    value={drafts[i]}
                    onChange={(e) => setComment(i, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") removeComment(i);
                    }}
                  />
                  <button className="ghost-btn xs" onClick={() => removeComment(i)}>
                    Remove
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <footer className="review-footer">
        <span className="muted">
          {commentCount} comment{commentCount === 1 ? "" : "s"}
        </span>
        <div className="review-actions">
          <button className="ghost-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-btn" onClick={submit} disabled={commentCount === 0}>
            Send revision
          </button>
        </div>
      </footer>
    </aside>
  );
}
