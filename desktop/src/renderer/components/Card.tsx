import { SUMMARY_RANGE_KEYS, type SummaryRangeKey } from "@codex-kaboo/shared/summary";
import type { CardState, UpdateSettingsRequest } from "../../main/ipc";
import { LiveStrip } from "./LiveStrip";
import { QuotaRow } from "./QuotaRow";
import { SettingsPanel } from "./SettingsPanel";
import { Totals } from "./Totals";
import { CloseIcon, ExternalIcon, RefreshIcon, SettingsIcon } from "./icons";

const TAB_LABELS: Record<SummaryRangeKey, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
  all: "All",
};

export interface CardActions {
  refresh(): void;
  syncNow(): void;
  update(patch: UpdateSettingsRequest): void;
  openDashboard(): void;
  quit(): void;
  toggleSettings(): void;
}

/**
 * The whole card, as a function of state — no effects, no bridge, no clock of its own.
 *
 * `App` owns all of that and hands the result down. The split is what makes the card renderable in
 * a test: every "what if there is no range / no quota / no account" branch below is reachable from
 * CI, and those are precisely the ones that would otherwise show up as a blank popover in someone's
 * menu bar with nothing to read.
 */
export function Card({
  state,
  now,
  showSettings,
  actions,
}: {
  state: CardState;
  now: number;
  showSettings: boolean;
  actions: CardActions;
}): React.ReactElement {
  const { report, settings, sync } = state;
  const range = report?.ranges?.[settings.range] ?? null;
  const notLoggedIn = report !== null && report.exitCode === 2;

  return (
    <div className="card">
      <header className="header">
        <span className="mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span className="wordmark">kaboo</span>
        <span className="header-spacer" />
        <button
          type="button"
          className="icon-button"
          title="Refresh"
          data-busy={state.refreshing}
          onClick={actions.refresh}
        >
          <RefreshIcon />
        </button>
        <button
          type="button"
          className="icon-button"
          title={showSettings ? "Back" : "Settings"}
          onClick={actions.toggleSettings}
        >
          {showSettings ? <CloseIcon /> : <SettingsIcon />}
        </button>
      </header>

      {!showSettings && (
        <div className="tabs" role="tablist">
          {SUMMARY_RANGE_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              className="tab"
              aria-selected={settings.range === key}
              onClick={() => actions.update({ range: key })}
            >
              {TAB_LABELS[key]}
            </button>
          ))}
        </div>
      )}

      <div className="body">
        {showSettings ? (
          <SettingsPanel
            settings={settings}
            appVersion={state.appVersion}
            platform={report?.machine.platform ?? ""}
            onChange={actions.update}
            onQuit={actions.quit}
          />
        ) : (
          <>
            {notLoggedIn && <NotLoggedIn />}
            {range !== null && report !== null && (
              <Totals range={range} fetchedAt={report.fetchedAt} now={now} />
            )}
            {report !== null && range === null && !notLoggedIn && (
              <div className="notice">
                No totals yet — the dashboard could not be reached and nothing is cached.
              </div>
            )}
            {report !== null && (
              <LiveStrip
                live={report.live}
                windowMinutes={settings.windowMinutes}
                machineLabel={report.machine.label ?? "This machine"}
              />
            )}
            {report !== null && <QuotaRow quota={report.quota} now={now} />}
            {report !== null && report.errors.length > 0 && !notLoggedIn && (
              <div className="notice">{report.errors[0]}</div>
            )}
          </>
        )}
      </div>

      <footer className="footer">
        <button
          type="button"
          className="button button-primary"
          disabled={sync.state === "running"}
          onClick={actions.syncNow}
        >
          {sync.state === "running" ? "Syncing…" : "Sync now"}
        </button>
        {sync.state === "blocked" && (
          <span className="muted" style={{ fontSize: 11 }}>
            A scheduled sync is already running
          </span>
        )}
        {sync.state === "idle" && sync.lastError !== null && (
          <span className="muted" style={{ fontSize: 11 }}>
            Last sync failed
          </span>
        )}
        <span style={{ flex: 1 }} />
        {state.dashboardUrl !== null && (
          <button type="button" className="button" onClick={actions.openDashboard}>
            Dashboard <ExternalIcon />
          </button>
        )}
      </footer>
    </div>
  );
}

function NotLoggedIn(): React.ReactElement {
  return (
    <div className="empty">
      <strong>Not connected yet</strong>
      <p className="muted" style={{ margin: 0 }}>
        Create a sync token in the dashboard under Settings, then run:
      </p>
      <code>codex-kaboo login</code>
      <p className="muted" style={{ margin: 0, fontSize: 11 }}>
        Live tokens per second works without it — it reads your local Codex logs.
      </p>
    </div>
  );
}
