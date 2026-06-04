import { useState } from "react";
import type { HarnessQuestion } from "@bobby/shared";

/**
 * Renders harness questions (e.g. Claude's AskUserQuestion) as pickable
 * options. Bobby can't answer mid-turn (turns are headless/one-shot), so the
 * selection is sent back as the next message, resuming the session.
 *
 * - Single question, single-select ⇒ click an option to answer immediately.
 * - Multi-select or multiple questions ⇒ toggle choices, then "Send answer".
 */
export function QuestionCard({
  questions,
  onAnswer,
}: {
  questions: HarnessQuestion[];
  onAnswer: (text: string) => void;
}) {
  // selections[i] = set of chosen labels for question i
  const [selections, setSelections] = useState<string[][]>(() => questions.map(() => []));
  // Free-text reply — Claude's AskUserQuestion always lets you answer in your
  // own words instead of (or alongside) picking a preset option.
  const [freeText, setFreeText] = useState("");

  const oneShot = questions.length === 1 && !questions[0].multiSelect;

  const format = (sel: string[][]) =>
    questions
      .map((q, i) => {
        const labels = sel[i];
        if (!labels.length) return null;
        const ans = labels.join(", ");
        return q.header ? `${q.header}: ${ans}` : ans;
      })
      .filter((line): line is string => line !== null)
      .join("\n");

  const toggle = (qi: number, label: string) => {
    setSelections((prev) => {
      const next = prev.map((s) => [...s]);
      const q = questions[qi];
      if (q.multiSelect) {
        next[qi] = next[qi].includes(label) ? next[qi].filter((l) => l !== label) : [...next[qi], label];
      } else {
        next[qi] = next[qi][0] === label ? [] : [label];
      }
      return next;
    });
  };

  const answerNow = (qi: number, label: string) => {
    const next = questions.map((_, i) => (i === qi ? [label] : selections[i]));
    onAnswer(format(next));
  };

  const allAnswered = selections.every((s) => s.length > 0);

  const sendFreeText = () => {
    const text = freeText.trim();
    if (text) onAnswer(text);
  };

  return (
    <div className="qcard">
      {questions.map((q, qi) => (
        <div className="qcard-q" key={qi}>
          <div className="qcard-question">
            {q.question}
            {q.multiSelect && <span className="qcard-hint"> · choose any</span>}
          </div>
          <div className="qcard-options">
            {q.options.map((opt) => {
              const selected = selections[qi].includes(opt.label);
              return (
                <button
                  key={opt.label}
                  className={`qopt ${selected ? "selected" : ""}`}
                  onClick={() => (oneShot ? answerNow(qi, opt.label) : toggle(qi, opt.label))}
                  title={opt.description}
                >
                  <span className="qopt-label">{opt.label}</span>
                  {opt.description && <span className="qopt-desc">{opt.description}</span>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {!oneShot && (
        <div className="qcard-actions">
          <button
            className="primary-btn"
            disabled={!allAnswered}
            onClick={() => onAnswer(format(selections))}
          >
            Send answer
          </button>
        </div>
      )}

      <div className="qcard-free">
        <textarea
          className="qcard-free-input"
          rows={2}
          value={freeText}
          placeholder="…or reply in your own words"
          onChange={(e) => setFreeText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              sendFreeText();
            }
          }}
        />
        <button className="ghost-btn" disabled={!freeText.trim()} onClick={sendFreeText}>
          Send reply
        </button>
      </div>
    </div>
  );
}
