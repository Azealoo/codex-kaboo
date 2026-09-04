"use client";

import { useEffect, useRef } from "react";
import { heatColor } from "@/lib/colors";
import { formatCompact } from "@/lib/format";
import {
  ACTIVITY_THRESHOLDS,
  describeCell,
  WEEKDAY_LABELS,
  type ActivityGrid,
} from "@/lib/heatmap";
import { CellTooltip, useCellTooltip } from "./cell-tooltip";

/** GitHub-style weeks × 7 grid with fixed bins (<10M, <100M, <1B, ≥1B tokens).
 *  `unpriced` flags the query's `unpricedModels.length > 0`, so every cell's dollar figure is
 *  qualified when the range's cost total is known to understate true list-price spend. */
export function ActivityHeatmap({ grid, unpriced }: { grid: ActivityGrid; unpriced: boolean }) {
  const { tip, show, hide } = useCellTooltip();
  const columns = grid.weeks.length;
  const scroller = useRef<HTMLDivElement>(null);
  // 53 weeks × 11 px does not fit a phone; the recent weeks are the ones worth seeing first.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [columns]);
  return (
    <div ref={scroller} className="relative overflow-x-auto" data-heatmap>
      <CellTooltip tip={tip} />
      <div
        role="grid"
        aria-label="Daily token usage heatmap"
        className="inline-grid gap-0.5"
        style={{ gridTemplateColumns: `auto repeat(${columns}, 11px)` }}
      >
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
            <div className="pr-1 text-[10px] leading-[11px] text-muted-foreground">
              {row % 2 === 0 ? day : ""}
            </div>
            {grid.weeks.map((week, col) => {
              const c = week[row]!;
              if (!c.inRange) return <div key={col} className="size-[11px]" aria-hidden="true" />;
              const text = describeCell(c, unpriced);
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
          <span
            key={level}
            className="inline-block size-[11px] rounded-[2px]"
            style={{ backgroundColor: heatColor(level) }}
            aria-hidden="true"
          />
        ))}
        <span>More</span>
        <span className="ml-2">
          bins: &lt;{formatCompact(ACTIVITY_THRESHOLDS[0])}, &lt;
          {formatCompact(ACTIVITY_THRESHOLDS[1])}, &lt;
          {formatCompact(ACTIVITY_THRESHOLDS[2])}, ≥{formatCompact(ACTIVITY_THRESHOLDS[2])} tokens
        </span>
      </div>
    </div>
  );
}
