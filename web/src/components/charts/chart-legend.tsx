import type { SeriesDef } from "@/lib/chart-data";

/** HTML legend (never inside the SVG). Rendered only for two or more series. */
export function ChartLegend({ series, shape = "rect" }: { series: SeriesDef[]; shape?: "rect" | "line" }) {
  if (series.length < 2) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span
            className={shape === "rect" ? "inline-block size-2.5 rounded-sm" : "inline-block h-0.5 w-3 rounded-full"}
            style={{ backgroundColor: s.color }}
            aria-hidden="true"
          />
          {s.label}
        </li>
      ))}
    </ul>
  );
}
