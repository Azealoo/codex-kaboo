import type { QuotaHistoryPoint } from "@convex/lib/types";
import { quotaColor } from "@/lib/colors";
import { resetMarkers, sparklinePath, sparklinePoints } from "@/lib/quota-history";

const W = 240;
const H = 40;

/** The last few days of the shared quota as one thin line; resets show as vertical hairlines. */
export function QuotaSparkline({
  points,
  from,
  to,
  days,
}: {
  points: QuotaHistoryPoint[];
  from: number;
  to: number;
  days: number;
}) {
  const mapped = sparklinePoints(points, from, to, W, H);
  if (mapped.length === 0) return null;
  const last = points[points.length - 1]!;
  const lastXY = mapped[mapped.length - 1]!;
  const span = to - from;
  const label = `Quota used over the last ${days} days: ${points.length} readings, now ${Math.round(last.usedPercent)}%`;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-10 w-full"
      role="img"
      aria-label={label}
      preserveAspectRatio="none"
    >
      {[0.6, 0.85].map((level) => (
        <line
          key={level}
          x1={0}
          x2={W}
          y1={H - level * H}
          y2={H - level * H}
          stroke="var(--grid-line)"
          strokeDasharray="2 3"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {resetMarkers(points)
        .filter((t) => t >= from && t <= to)
        .map((t) => {
          const x = ((t - from) / span) * W;
          return (
            <line
              key={t}
              data-testid="quota-reset"
              x1={x}
              x2={x}
              y1={0}
              y2={H}
              stroke="var(--border)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      {mapped.length >= 2 ? (
        <path
          data-testid="quota-spark"
          d={sparklinePath(mapped)}
          fill="none"
          stroke="var(--foreground)"
          strokeOpacity={0.7}
          strokeWidth={1.5}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      <circle cx={lastXY.x} cy={lastXY.y} r={2.5} fill={quotaColor(last.usedPercent)} />
    </svg>
  );
}
