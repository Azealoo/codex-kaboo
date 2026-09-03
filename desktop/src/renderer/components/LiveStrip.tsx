import { niceMax, type TpsWindow } from "@cli/card/buckets";
import { formatCompact } from "@codex-kaboo/shared/format";

/** The dashboard's series palette, so a model is the same colour on both surfaces. */
const SERIES = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

const VIEW_WIDTH = 348;
const VIEW_HEIGHT = 56;

/**
 * A stacked bar per bucket, one colour per model.
 *
 * Drawn in SVG user units against a fixed viewBox and scaled by CSS, so it is sharp at any window
 * width and needs no resize observer — a chart that re-measures itself twice a second in a menu
 * bar panel is a lot of work to draw 36 rectangles.
 */
export function LiveStrip({
  live,
  windowMinutes,
  machineLabel,
}: {
  live: TpsWindow;
  windowMinutes: number;
  machineLabel: string;
}): React.ReactElement {
  const max = niceMax(live.peakTps);
  const count = live.buckets.length;
  const slot = VIEW_WIDTH / Math.max(1, count);
  const barWidth = Math.max(1.5, slot - 1.5);
  const perSecond = live.bucketMs / 1000;
  const colourFor = (model: string): string =>
    SERIES[live.models.indexOf(model) % SERIES.length] ?? "var(--other-series)";

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="section-label">Tokens / second</span>
        <span className="tps-caption">
          {live.activeSessions} active session{live.activeSessions === 1 ? "" : "s"}
        </span>
      </div>

      <div className="tps-row">
        <div className="tps-metric">
          <span className="tps-value tabular">{Math.round(live.currentTps)}</span>
          <span className="tps-caption">current</span>
        </div>
        <div className="tps-metric">
          <span className="tps-value tabular">{live.averageTps.toFixed(1)}</span>
          <span className="tps-caption">{windowMinutes}m avg</span>
        </div>
        <div className="tps-metric" style={{ marginLeft: "auto", alignItems: "flex-end" }}>
          <span className="tps-value tabular">{formatCompact(live.totalOutput)}</span>
          <span className="tps-caption">output in window</span>
        </div>
      </div>

      <svg
        className="chart"
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Tokens per second over the last ${windowMinutes} minutes`}
      >
        <line
          className="chart-axis"
          x1="0"
          y1={VIEW_HEIGHT - 0.5}
          x2={VIEW_WIDTH}
          y2={VIEW_HEIGHT - 0.5}
        />
        {live.buckets.map((bucket, index) => {
          let offset = 0;
          return (
            <g key={bucket.startMs}>
              {bucket.byModel.map((entry) => {
                const rate = entry.output / perSecond;
                const height = (rate / max) * (VIEW_HEIGHT - 2);
                const y = VIEW_HEIGHT - 1 - offset - height;
                offset += height;
                return (
                  <rect
                    key={entry.key}
                    x={index * slot}
                    y={y}
                    width={barWidth}
                    height={Math.max(height, 0)}
                    rx={barWidth / 3}
                    fill={colourFor(entry.key)}
                  />
                );
              })}
            </g>
          );
        })}
      </svg>

      <div className="chart-footer">
        <span>−{windowMinutes}m</span>
        <span className="tabular">Max {max}</span>
        <span>now</span>
      </div>

      <div className="tps-caption" style={{ marginTop: 6 }}>
        {machineLabel}
        {live.models.length > 0 ? ` · ${live.models[0]}` : ""}
      </div>
    </section>
  );
}
