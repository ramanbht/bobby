import type { Plan, StepStatus } from "@bobby/shared";

const STEP_ICON: Record<StepStatus, string> = {
  pending: "○",
  running: "◐",
  done: "✓",
  failed: "✗",
};

/** Renders a proposed/executing plan as a reviewable checklist with per-step gating. */
export function PlanCard({
  plan,
  onApprove,
  onContinue,
  onStop,
}: {
  plan: Plan;
  onApprove: () => void;
  onContinue: () => void;
  onStop: () => void;
}) {
  const done = plan.steps.filter((s) => s.status === "done").length;
  const total = plan.steps.length;

  const statusLabel =
    plan.status === "running" ? `running · ${done}/${total}` :
    plan.status === "paused"  ? `paused · ${done}/${total}` :
    plan.status;

  return (
    <div className={`plan-card plan-${plan.status}`}>
      <div className="plan-head">
        <span className="plan-title">◆ Plan</span>
        <span className={`plan-status status-${plan.status}`}>{statusLabel}</span>
      </div>

      <ol className="plan-steps">
        {plan.steps.map((s) => (
          <li key={s.id} className={`plan-step step-${s.status}`}>
            <span className={`step-icon ${s.status === "running" ? "spin" : ""}`}>{STEP_ICON[s.status]}</span>
            <span className="step-text">{s.text}</span>
          </li>
        ))}
      </ol>

      <div className="plan-actions">
        {plan.status === "proposed" && (
          <button className="primary-btn" onClick={onApprove}>▶ Approve &amp; run step 1</button>
        )}
        {plan.status === "paused" && (
          <>
            <button className="primary-btn" onClick={onContinue}>▶ Continue · step {done + 1}</button>
            <button className="ghost-btn" onClick={onStop}>■ Stop</button>
          </>
        )}
        {plan.status === "running" && (
          <button className="ghost-btn" onClick={onStop}>■ Stop</button>
        )}
        {plan.status === "done" && <span className="muted">Plan complete.</span>}
        {plan.status === "cancelled" && <span className="muted">Stopped.</span>}
      </div>
    </div>
  );
}
