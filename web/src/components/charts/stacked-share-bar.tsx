import type { Segment } from "@/lib/chart-data";
import { formatPercent } from "@shared/format";

/** A 100 % horizontal bar with 2 px surface gaps, plus a legend row per segment (never a pie). */
export function StackedShareBar({
  segments,
  format,
  showLegend = true,
}: {
  segments: Segment[];
  format: (value: number) => string;
  showLegend?: boolean;
}) {
  const visible = segments.filter((s) => s.share > 0);
  return (
    <div className="flex flex-col gap-3">
      <div
        className="flex h-3 w-full gap-0.5 overflow-hidden rounded-sm bg-muted"
        role="list"
        aria-label="Share"
      >
        {visible.map((s) => (
          <div
            key={s.key}
            role="listitem"
            data-testid="share-segment"
            aria-label={`${s.label}: ${format(s.value)} (${formatPercent(s.share)})`}
            title={`${s.label}: ${format(s.value)} (${formatPercent(s.share)})`}
            className="h-full min-w-0.5 rounded-[2px]"
            style={{ width: `${s.share * 100}%`, backgroundColor: s.color }}
          />
        ))}
      </div>
      {showLegend ? (
        <ul className="grid gap-1 text-xs sm:grid-cols-2">
          {segments.map((s) => (
            <li key={s.key} className="flex items-center gap-2">
              <span
                className="inline-block size-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: s.color }}
                aria-hidden="true"
              />
              <span className="truncate text-muted-foreground">{s.label}</span>
              <span className="ml-auto font-medium tabular">{format(s.value)}</span>
              <span className="w-12 text-right text-muted-foreground tabular">
                {formatPercent(s.share)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
