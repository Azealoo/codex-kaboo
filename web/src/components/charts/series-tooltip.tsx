"use client";

import type { TooltipContentProps } from "recharts";
import type { SeriesDef } from "@/lib/chart-data";

type Props = Partial<TooltipContentProps<number, string>> & {
  series: SeriesDef[];
  format: (value: number) => string;
};

/** Custom Recharts tooltip: every series at the hovered X, sorted by value, plus a total. */
export function SeriesTooltip({ active, payload, label, series, format }: Props) {
  if (!active || !payload || payload.length === 0) return null;
  const byKey = new Map(series.map((s) => [s.key, s]));
  const rows = payload
    .map((p) => ({ key: String(p.dataKey), value: typeof p.value === "number" ? p.value : 0, def: byKey.get(String(p.dataKey)) }))
    .filter((r): r is { key: string; value: number; def: SeriesDef } => r.def !== undefined)
    .sort((a, b) => b.value - a.value);
  const total = rows.reduce((acc, r) => acc + r.value, 0);
  return (
    <div className="min-w-40 rounded-md border border-border bg-popover px-3 py-2 text-xs">
      <p className="mb-1 font-medium">{label}</p>
      <ul className="space-y-0.5">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-2">
            <span className="inline-block h-0.5 w-3 rounded-full" style={{ backgroundColor: r.def.color }} aria-hidden="true" />
            <span className="text-muted-foreground">{r.def.label}</span>
            <span className="ml-auto font-medium tabular">{format(r.value)}</span>
          </li>
        ))}
      </ul>
      {rows.length > 1 ? (
        <p className="mt-1 flex justify-between border-t border-border pt-1 font-medium">
          <span>Total</span>
          <span className="tabular">{format(total)}</span>
        </p>
      ) : null}
    </div>
  );
}
