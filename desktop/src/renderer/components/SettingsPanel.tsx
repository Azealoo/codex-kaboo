import type { CardSettings } from "../../main/settings";
import type { UpdateSettingsRequest } from "../../main/ipc";

const REFRESH_CHOICES = [
  { label: "1 min", ms: 60_000 },
  { label: "5 min", ms: 5 * 60_000 },
  { label: "15 min", ms: 15 * 60_000 },
  { label: "1 hour", ms: 60 * 60_000 },
];

const WINDOW_CHOICES = [1, 3, 5, 10, 30];

export function SettingsPanel({
  settings,
  appVersion,
  platform,
  onChange,
  onQuit,
}: {
  settings: CardSettings;
  appVersion: string;
  /** `process.platform` as the main process reported it — not sniffed from the user agent. */
  platform: string;
  onChange: (patch: UpdateSettingsRequest) => void;
  onQuit: () => void;
}): React.ReactElement {
  return (
    <section className="settings">
      <label className="setting">
        <span>Refresh totals</span>
        <select
          value={settings.refreshMs}
          onChange={(event) => onChange({ refreshMs: Number(event.target.value) })}
        >
          {REFRESH_CHOICES.map((choice) => (
            <option key={choice.ms} value={choice.ms}>
              {choice.label}
            </option>
          ))}
        </select>
      </label>

      <label className="setting">
        <span>Live window</span>
        <select
          value={settings.windowMinutes}
          onChange={(event) => onChange({ windowMinutes: Number(event.target.value) })}
        >
          {WINDOW_CHOICES.map((minutes) => (
            <option key={minutes} value={minutes}>
              {minutes} min
            </option>
          ))}
        </select>
      </label>

      <label className="setting">
        <span>Start at login</span>
        <input
          type="checkbox"
          checked={settings.launchAtLogin}
          onChange={(event) => onChange({ launchAtLogin: event.target.checked })}
        />
      </label>

      {/* macOS only: Windows and Linux tray icons have nowhere to put a label. */}
      {platform === "darwin" && (
        <label className="setting">
          <span>Show today&apos;s tokens in the menu bar</span>
          <input
            type="checkbox"
            checked={settings.showTrayLabel}
            onChange={(event) => onChange({ showTrayLabel: event.target.checked })}
          />
        </label>
      )}

      <div className="setting">
        <span className="muted">Version {appVersion}</span>
        <button type="button" className="button" onClick={onQuit}>
          Quit codex-kaboo
        </button>
      </div>

      <p className="muted" style={{ fontSize: 11, margin: 0 }}>
        The card reads your local Codex logs and talks only to your own dashboard. No prompt text,
        command, file path or repository name ever leaves this machine — run{" "}
        <code>codex-kaboo sync --dry-run --json</code> to see exactly what is sent.
      </p>
    </section>
  );
}
