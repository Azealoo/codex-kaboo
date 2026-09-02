"use client";

import { useCallback, useState, type ReactNode, type SyntheticEvent } from "react";

export type CellTip = { content: ReactNode; x: number; y: number } | null;

/** One positioned tooltip shared by every cell of a heatmap (hover and keyboard focus). */
export function useCellTooltip() {
  const [tip, setTip] = useState<CellTip>(null);
  const show = useCallback((event: SyntheticEvent<HTMLElement>, content: ReactNode) => {
    const target = event.currentTarget;
    const container = target.closest("[data-heatmap]") as HTMLElement | null;
    const rect = target.getBoundingClientRect();
    const base = container?.getBoundingClientRect() ?? { left: 0, top: 0 };
    setTip({ content, x: rect.left - base.left + rect.width / 2, y: rect.top - base.top });
  }, []);
  const hide = useCallback(() => setTip(null), []);
  return { tip, show, hide };
}

export function CellTooltip({ tip }: { tip: CellTip }) {
  if (!tip) return null;
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-popover px-2 py-1 text-xs whitespace-nowrap"
      style={{ left: tip.x, top: tip.y - 6 }}
    >
      {tip.content}
    </div>
  );
}
