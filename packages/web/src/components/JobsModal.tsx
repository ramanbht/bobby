import { useEffect, useState } from "react";
import type { HarnessId, HarnessInfo, Job } from "@bobby/shared";
import { api } from "../api.js";

const PRESETS: { label: string; cron: string }[] = [
  { label: "Every hour", cron: "0 * * * *" },
  { label: "Every day at 9am", cron: "0 9 * * *" },
  { label: "Every weekday at 9am", cron: "0 9 * * 1-5" },
  { label: "Every Monday at 9am", cron: "0 9 * * 1" },
  { label: "Every 15 minutes", cron: "*/15 * * * *" },
  { label: "Custom…", cron: "" },
];

export function JobsModal({
  harnesses,
  onClose,
  onOpenChat,
}: {
  harnesses: HarnessInfo[];
  onClose: () => void;
  onOpenChat: (chatId: string) => void;
}) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState<string | null>(null);

  const firstAvailable = harnesses.find((h) => h.available)?.id ?? "claude";
  const [name, setName] = useState("");
  const [harness, setHarness] = useState<HarnessId>(firstAvailable);
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [preset, setPreset] = useState(PRESETS[1].cron);
  const [customCron, setCustomCron] = useState("");
  const isCustom = preset === "";

  const refresh = () => api.listJobs().then(setJobs).catch((e) => setError(e.message));
  useEffect(() => {
    refresh();
  }, []);

  const create = async () => {
    setError(null);
    const schedule = (isCustom ? customCron : preset).trim();
    if (!name.trim() || !prompt.trim() || !schedule) {
      setError("Name, prompt and schedule are required.");
      return;
    }
    try {
      await api.createJob({ name, harness, model: model.trim() || undefined, prompt, schedule });
      setName("");
      setPrompt("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const toggle = async (job: Job) => {
    await api.updateJob(job.id, { enabled: !job.enabled }).catch((e) => setError(e.message));
    refresh();
  };
  const remove = async (job: Job) => {
    if (!confirm(`Delete job "${job.name}" and its run history?`)) return;
    await api.deleteJob(job.id).catch((e) => setError(e.message));
    refresh();
  };
  const runNow = async (job: Job) => {
    await api.runJob(job.id).catch((e) => setError(e.message));
    setTimeout(refresh, 1500);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>⏱ Scheduled jobs</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {error && <div className="config-error">{error}</div>}

          {jobs.length === 0 && <p className="muted">No scheduled jobs yet. Create one below.</p>}
          {jobs.map((job) => (
            <div key={job.id} className="job-row">
              <div className="job-main">
                <div className="job-name">
                  {job.name}
                  <span className="badge badge-dim">{job.harness}{job.model ? ` · ${job.model}` : ""}</span>
                </div>
                <div className="job-meta">
                  <code>{job.schedule}</code>
                  {job.lastRunAt ? ` · last run ${new Date(job.lastRunAt).toLocaleString()} (${job.lastStatus})` : " · never run"}
                </div>
              </div>
              <div className="job-controls">
                <label className="switch" title={job.enabled ? "Enabled" : "Disabled"}>
                  <input type="checkbox" checked={job.enabled} onChange={() => toggle(job)} />
                  <span>{job.enabled ? "on" : "off"}</span>
                </label>
                <button className="link-btn" onClick={() => runNow(job)}>Run now</button>
                <button className="link-btn" onClick={() => onOpenChat(job.chatId)}>Open chat</button>
                <button className="link-btn danger" onClick={() => remove(job)}>Delete</button>
              </div>
            </div>
          ))}

          <fieldset className="job-create">
            <legend>New job</legend>
            <div className="row-field">
              <span className="row-label">Name</span>
              <input value={name} placeholder="Morning digest" onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="row-field">
              <span className="row-label">Harness</span>
              <select value={harness} onChange={(e) => setHarness(e.target.value as HarnessId)}>
                {harnesses.map((h) => (
                  <option key={h.id} value={h.id} disabled={!h.available}>
                    {h.label}{h.available ? "" : " (not installed)"}
                  </option>
                ))}
              </select>
              <input className="model-inline" value={model} placeholder="model (optional)" onChange={(e) => setModel(e.target.value)} />
            </div>
            <div className="row-field align-top">
              <span className="row-label">Prompt</span>
              <textarea value={prompt} rows={3} placeholder="What should run on schedule?" onChange={(e) => setPrompt(e.target.value)} />
            </div>
            <div className="row-field">
              <span className="row-label">Schedule</span>
              <select value={preset} onChange={(e) => setPreset(e.target.value)}>
                {PRESETS.map((p) => (
                  <option key={p.label} value={p.cron}>{p.label}{p.cron ? ` (${p.cron})` : ""}</option>
                ))}
              </select>
              {isCustom && (
                <input className="model-inline" value={customCron} placeholder="cron e.g. 0 9 * * *" onChange={(e) => setCustomCron(e.target.value)} />
              )}
            </div>
            <div className="config-actions">
              <button className="primary-btn" onClick={create}>Create job</button>
            </div>
          </fieldset>
        </div>
      </div>
    </div>
  );
}
