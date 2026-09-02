"use client";

import { heatColor } from "@/lib/colors";
import { formatCompact, formatDay, formatUsd } from "@/lib/format";
import { ACTIVITY_THRESHOLDS, WEEKDAY_LABELS, type ActivityCell, type ActivityGrid } from "@/lib/heatmap";
import { CellTooltip, useCellTooltip } from "./cell-tooltip";

function describeCell(c: ActivityCell): string {
  return `${formatDay(c.day)}: ${formatCompact(c.tokens)} tokens, ${c.sessions} sessions, ${formatUsd(c.costUsd)}`;
}

/** GitHub-style weeks × 7 grid with fixed bins (<10M, <100M, <1B, ≥1B tokens). */
export function ActivityHeatmap({ grid }: { grid: ActivityGrid }) {
  const { tip, show, hide } = useCellTooltip();
  const columns = grid.weeks.length;
  return (
    <div className="relative overflow-x-auto" data-heatmap>
      <CellTooltip tip={tip} />
      <div className="inline-grid gap-0.5" style={{ gridTemplateColumns: `auto repeat(${columns}, 11px)` }}>
        <div />
        {grid.weeks.map((_, col) => {
          const label = grid.monthLabels.find((m) => m.column === col)?.label;
          return (
            <div key={col} className="h-4 text-[10px] leading-4 text-muted-foreground">
              {label ?? ""}
            </div>
          );
        })}
        {WEEKDAY_LABELS.map((day, row) => (
          <div key={day} className="contents" role="row">
            <div className="pr-1 text-[10px] leading-[11px] text-muted-foreground">{row % 2 === 0 ? day : ""}</div>
            {grid.weeks.map((week, col) => {
              const c = week[row]!;
              if (!c.inRange) return <div key={col} className="size-[11px]" aria-hidden="true" />;
              const text = describeCell(c);
              return (
                <button
                  key={col}
                  type="button"
                  role="gridcell"
                  aria-label={text}
                  className="size-[11px] rounded-[2px] outline-offset-1"
                  style={{ backgroundColor: heatColor(c.level) }}
                  onMouseEnter={(e) => show(e, text)}
                  onFocus={(e) => show(e, text)}
                  onMouseLeave={hide}
                  onBlur={hide}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
        <span>Less</span>
        {([0, 1, 2, 3, 4] as const).map((level) => (
          <span key={level} className="inline-block size-[11px] rounded-[2px]" style={{ backgroundColor: heatColor(level) }} aria-hidden="true" />
        ))}
        <span>More</span>
        <span className="ml-2">
          bins: &lt;{formatCompact(ACTIVITY_THRESHOLDS[0])}, &lt;{formatCompact(ACTIVITY_THRESHOLDS[1])}, &lt;
          {formatCompact(ACTIVITY_THRESHOLDS[2])}, ≥{formatCompact(ACTIVITY_THRESHOLDS[2])} tokens
        </span>
      </div>
    </div>
  );
}
