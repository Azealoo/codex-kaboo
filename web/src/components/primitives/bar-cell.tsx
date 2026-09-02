import type { ReactNode } from "react";

export type BarScale = "linear" | "log";

export function barWidth(value: number, max: number, scale: BarScale): number {
  if (max <= 0 || value <= 0) return 0;
  if (scale === "log") return Math.min(1, Math.log10(value + 1) / Math.log10(max + 1));
  return Math.min(1, value / max);
}

export function BarCell({
  value,
  max,
  scale,
  color = "var(--primary)",
  children,
}: {
  value: number;
  max: number;
  scale: BarScale;
  color?: string;
  children: ReactNode;
}) {
  const pct = Math.round(barWidth(value, max, scale) * 10000) / 100;
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-sm bg-muted" aria-hidden="true">
        <div data-testid="bar-fill" className="h-full rounded-sm" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="tabular">{children}</span>
    </div>
  );
}
