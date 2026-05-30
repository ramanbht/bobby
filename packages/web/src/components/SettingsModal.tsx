import { useState } from "react";
import type { AppSettings, HarnessId, HarnessInfo, ServerConfigInfo } from "@bobby/shared";

export function SettingsModal({
  settings,
  harnesses,
  serverConfig,
  onClose,
  onSave,
}: {
  settings: AppSettings;
  harnesses: HarnessInfo[];
  serverConfig: ServerConfigInfo | null;
  onClose: () => void;
  onSave: (s: AppSettings) => Promise<void>;
}) {
  const [defaultHarness, setDefaultHarness] = useState<HarnessId>(settings.defaultHarness);
  const [models, setModels] = useState<Partial<Record<HarnessId, string>>>(settings.models ?? {});
  const [agent, setAgent] = useState(settings.defaultConfig?.agent ?? "");
  const [skills, setSkills] = useState((settings.defaultConfig?.skills ?? []).join(", "));
  const [obsidianVault, setObsidianVault] = useState(settings.obsidianVault ?? "");
  const [saving, setSaving] = useState(false);

  // Live preview of whether distillation will be on once these settings save.
  const vaultTyped = obsidianVault.trim().length > 0;
  const envProvidesVault =
    !vaultTyped && !(settings.obsidianVault ?? "").trim() && !!serverConfig?.obsidianConfigured;
  const distillOn = vaultTyped || envProvidesVault;
  const distillDetail = vaultTyped
    ? "notes will be saved to this vault"
    : envProvidesVault
      ? "using the OBSIDIAN_VAULT environment variable"
      : "set a vault path below to enable the ✦ Distill button";

  const save = async () => {
    setSaving(true);
    try {
      await onSave({
        defaultHarness,
        models,
        defaultConfig: {
          agent: agent.trim() || undefined,
          skills: parseList(skills),
        },
        obsidianVault: obsidianVault.trim() || undefined,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2>Settings</h2>
          <button className="icon-btn" onClick={onClose} title="Close">×</button>
        </header>

        <div className="modal-body">
          <label className="field">
            <span>Default harness</span>
            <select value={defaultHarness} onChange={(e) => setDefaultHarness(e.target.value as HarnessId)}>
              {harnesses.map((h) => (
                <option key={h.id} value={h.id} disabled={!h.available}>
                  {h.label}{h.available ? "" : " (not installed)"}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="field">
            <legend>Default model per harness</legend>
            {harnesses.map((h) => (
              <label key={h.id} className="row-field">
                <span className="row-label">{h.label}</span>
                <input
                  value={models[h.id] ?? ""}
                  placeholder={modelPlaceholder(h.id)}
                  onChange={(e) => setModels((m) => ({ ...m, [h.id]: e.target.value }))}
                />
              </label>
            ))}
          </fieldset>

          <label className="field">
            <span>Default agent <span className="muted">(Claude)</span></span>
            <input value={agent} placeholder="e.g. reviewer" onChange={(e) => setAgent(e.target.value)} />
          </label>

          <label className="field">
            <span>Default skills <span className="muted">(comma-separated; Hermes &amp; pi)</span></span>
            <input value={skills} placeholder="e.g. pdf, xlsx" onChange={(e) => setSkills(e.target.value)} />
          </label>

          <fieldset className="field">
            <legend>Obsidian distillation</legend>

            <div className={`settings-status ${distillOn ? "on" : "off"}`}>
              <span className="settings-status-dot" />
              <span>
                <strong>Distillation {distillOn ? "ON" : "OFF"}</strong> — {distillDetail}
              </span>
            </div>

            <label className="row-field">
              <span className="row-label">Vault path</span>
              <input
                value={obsidianVault}
                placeholder="/Users/you/ObsidianVault"
                onChange={(e) => setObsidianVault(e.target.value)}
              />
            </label>

            <span className="field-hint muted">
              Absolute path to your Obsidian vault. The ✦ Distill button writes a note of each
              chat's key takeaways into it. Clear this field to turn distillation off (the
              <code> OBSIDIAN_VAULT</code> env var is used as a fallback).
            </span>

            {serverConfig && (
              <span className="field-hint muted">
                Distill harness: <strong>{serverConfig.distillHarness}</strong> · Auto-distill
                after each turn: <strong>{serverConfig.autoDistill ? "on" : "off"}</strong>
                {serverConfig.autoDistill ? "" : " (set BOBBY_AUTO_DISTILL=true to enable)"}
              </span>
            )}
          </fieldset>
        </div>

        <footer className="modal-footer">
          <button className="ghost-btn" onClick={onClose}>Cancel</button>
          <button className="primary-btn" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save settings"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function parseList(s: string): string[] {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

function modelPlaceholder(id: HarnessId): string {
  switch (id) {
    case "claude":
      return "sonnet, opus, claude-sonnet-4-6…";
    case "hermes":
      return "anthropic/claude-sonnet-4.6";
    case "pi":
      return "google/gemini, anthropic/…";
  }
}
