import { formatPercent, formatRelative, formatResetsIn } from "@codex-kaboo/shared/format";
import type { QuotaEnvelope } from "@codex-kaboo/shared/summary";

function windowLabel(minutes: number): string {
  if (minutes >= 1440) return `${Math.round(minutes / 1440)}d`;
  if (minutes >= 60) return `${Math.round(minutes / 60)}h`;
  return `${minutes}m`;
}

function level(usedPercent: number): "good" | "warning" | "critical" {
  if (usedPercent >= 90) return "critical";
  if (usedPercent >= 70) return "warning";
  return "good";
}

/**
 * The Codex quota, always rendered — even with nothing to show.
 *
 * A row that says why it is empty is worth more than a row that vanishes: "no reading yet" tells
 * you a sync has not seen a rate limit, which is a real, fixable state. This is also what the
 * envelope's `source` is for: the card can say whether the number describes the account or only
 * this machine.
 */
export function QuotaRow({
  quota,
  now,
}: {
  quota: QuotaEnvelope;
  now: number;
}): React.ReactElement {
  return (
    <section className="quota">
      <span className="section-label">Provider quota</span>
      {quota.value === null ? (
        <div className="notice" data-tone="muted">
          No reading yet — it arrives with the next sync of a session that hit a rate limit.
        </div>
      ) : (
        <>
          <div className="quota-head">
            <span>
              <strong>Codex</strong>
              <span className="muted">
                {quota.value.planType === null ? "" : ` ${quota.value.planType}`} ·{" "}
                {windowLabel(quota.value.windowMinutes)}
              </span>
            </span>
            <span className="tabular">{formatPercent(quota.value.usedPercent / 100, 0)}</span>
          </div>
          <div className="quota-meter" data-level={level(quota.value.usedPercent)}>
            <span style={{ width: `${Math.min(100, Math.max(0, quota.value.usedPercent))}%` }} />
          </div>
          <div className="tps-caption">
            {formatResetsIn(quota.value.resetsAt, now)}
            {" · "}
            {quota.source === "local"
              ? "this machine"
              : (quota.value.machine?.label ?? "account-wide")}
            {quota.stale
              ? ` · last seen ${formatRelative(quota.value.receivedAt ?? quota.value.observedAt, now)}`
              : ""}
          </div>
        </>
      )}
    </section>
  );
}
