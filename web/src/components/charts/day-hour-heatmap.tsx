"use client";

import { heatColor } from "@/lib/colors";
import { WEEKDAY_LABELS, heatLevel, hourLabel } from "@/lib/heatmap";
import { CellTooltip, useCellTooltip } from "./cell-tooltip";

/** Weekday × hour grid (Mon..Sun × 00..23), colored relative to the busiest cell. */
export function DayHourHeatmap({
  grid,
  format,
}: {
  grid: number[][];
  format: (value: number) => string;
}) {
  const { tip, show, hide } = useCellTooltip();
  const max = grid.reduce((m, row) => Math.max(m, ...row), 0);
  return (
    <div className="relative overflow-x-auto" data-heatmap>
      <CellTooltip tip={tip} />
      <div
        role="grid"
        aria-label="Token usage heatmap by weekday and hour"
        className="inline-grid gap-0.5"
        style={{ gridTemplateColumns: "auto repeat(24, minmax(14px, 1fr))" }}
      >
        <div />
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} className="text-center text-[10px] text-muted-foreground">
            {h % 3 === 0 ? hourLabel(h) : ""}
          </div>
        ))}
        {WEEKDAY_LABELS.map((day, row) => (
          <div key={day} className="contents" role="row">
            <div className="pr-1 text-[10px] leading-[14px] text-muted-foreground">{day}</div>
            {Array.from({ length: 24 }, (_, hour) => {
              const value = grid[row]?.[hour] ?? 0;
              const text = `${day} ${hourLabel(hour)}:00: ${format(value)} tokens`;
              return (
                <button
                  key={hour}
                  type="button"
                  role="gridcell"
                  aria-label={text}
                  className="h-[14px] w-full min-w-[14px] rounded-[2px] outline-offset-1"
                  style={{ backgroundColor: heatColor(heatLevel(value, max)) }}
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
    </div>
  );
}
