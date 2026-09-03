import { cacheHitRate } from "@codex-kaboo/shared/metrics";
import {
  formatCompact,
  formatDeltaPercent,
  formatPercent,
  formatRelative,
  formatUsd,
} from "@codex-kaboo/shared/format";
import type { RangeSummary } from "@codex-kaboo/shared/summary";

function direction(change: number | null): "up" | "down" | "flat" {
  if (change === null || change === 0) return "flat";
  return change > 0 ? "up" : "down";
}

export function Totals({
  range,
  fetchedAt,
  now,
}: {
  range: RangeSummary;
  /** When the server last answered — null when it never has. */
  fetchedAt: number | null;
  now: number;
}): React.ReactElement {
  const unpriced = range.unpricedModels.length;
  return (
    <section>
      <div className="section-label">Total tokens</div>
      <div className="total">
        <span className="total-value tabular">{formatCompact(range.tokens.total)}</span>
        {range.changePercent !== null && (
          <span className="delta tabular" data-direction={direction(range.changePercent)}>
            {formatDeltaPercent(range.changePercent)}
          </span>
        )}
      </div>
      <div className="sub-row">
        <span>
          Est. cost <strong className="tabular">{formatUsd(range.costUsd)}</strong>
        </span>
        {/* An unpriced model contributes nothing to the cost, so the number below is low by its
            share. Saying so is the difference between an estimate and a wrong number. */}
        {unpriced > 0 && (
          <span
            className="qualifier"
            title={`No price is set for: ${range.unpricedModels.join(", ")}`}
          >
            {unpriced} model{unpriced === 1 ? "" : "s"} unpriced
          </span>
        )}
        {/* Always the age of the numbers on screen, never "just now" because the source says
            so: a fetch that succeeded a second ago already formats as "just now", and a card
            showing that over an hour-old cache is the one lie this label must not tell. */}
        <span style={{ marginLeft: "auto" }}>
          {fetchedAt === null ? "Never synced" : `Synced ${formatRelative(fetchedAt, now)}`}
        </span>
      </div>
      <CacheSplit range={range} />
    </section>
  );
}

function CacheSplit({ range }: { range: RangeSummary }): React.ReactElement | null {
  const hit = cacheHitRate(range.tokens);
  if (hit === null) return null;
  const cachedPct = Math.max(0, Math.min(100, hit * 100));
  return (
    <div style={{ marginTop: 12 }}>
      <div className="cache-bar">
        <span className="cache-cached" style={{ width: `${cachedPct}%` }} />
        <span className="cache-new" style={{ width: `${100 - cachedPct}%` }} />
      </div>
      <div className="legend">
        <span>
          <i className="cache-cached" style={{ background: "var(--primary)" }} />
          Cached <span className="tabular">{formatPercent(hit)}</span>
        </span>
        <span>
          <i style={{ background: "var(--chart-4)" }} />
          New input{" "}
          <span className="tabular">
            {formatCompact(range.tokens.input - range.tokens.cachedInput)}
          </span>
        </span>
      </div>
    </div>
  );
}
