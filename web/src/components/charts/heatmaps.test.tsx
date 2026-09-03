import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildActivityGrid } from "@/lib/heatmap";
import { formatCompact } from "@/lib/format";
import { ActivityHeatmap } from "./activity-heatmap";
import { DayHourHeatmap } from "./day-hour-heatmap";

describe("ActivityHeatmap", () => {
  it("renders one cell per in-range day with an accessible label and heat color", () => {
    const grid = buildActivityGrid("2026-08-03", "2026-08-16", [
      { day: "2026-08-04", tokens: 25_000_000, sessions: 2, costUsd: 1.5 },
    ]);
    render(<ActivityHeatmap grid={grid} unpriced={false} />);
    const cells = screen.getAllByRole("gridcell");
    expect(cells).toHaveLength(14);
    const cell = screen.getByLabelText("Aug 4, 2026: 25M tokens, 2 sessions, $1.50");
    expect(cell).toHaveStyle({ backgroundColor: "#2f9f55" });
    expect(screen.getByText("Aug")).toBeInTheDocument();
  });

  it("exposes an ARIA grid with an accessible name and reachable gridcells", () => {
    const grid = buildActivityGrid("2026-08-03", "2026-08-16", [
      { day: "2026-08-04", tokens: 25_000_000, sessions: 2, costUsd: 1.5 },
    ]);
    render(<ActivityHeatmap grid={grid} unpriced={false} />);
    const gridEl = screen.getByRole("grid", { name: "Daily token usage heatmap" });
    expect(
      within(gridEl).getByRole("gridcell", { name: "Aug 4, 2026: 25M tokens, 2 sessions, $1.50" }),
    ).toBeInTheDocument();
  });

  it("qualifies every cell's aria-label (and identically, its hover tooltip) when the range has unpriced models", () => {
    // Fix 1: the heatmap used to print formatUsd(c.costUsd) unqualified even when the query's
    // unpricedModels was non-empty, so a real-but-understated total read as the whole story.
    const grid = buildActivityGrid("2026-08-03", "2026-08-16", [
      { day: "2026-08-04", tokens: 25_000_000, sessions: 2, costUsd: 1.5 },
    ]);
    render(<ActivityHeatmap grid={grid} unpriced={true} />);
    const cell = screen.getByLabelText("Aug 4, 2026: 25M tokens, 2 sessions, $1.50 (unpriced)");
    expect(cell).toBeInTheDocument();
  });
});

describe("DayHourHeatmap", () => {
  it("renders 7 × 24 cells and colors the maximum with the darkest step", () => {
    const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
    grid[0]![14] = 1_000_000;
    grid[4]![9] = 250_000;
    render(<DayHourHeatmap grid={grid} format={formatCompact} />);
    expect(screen.getAllByRole("gridcell")).toHaveLength(168);
    expect(screen.getByLabelText("Mon 14:00: 1M tokens")).toHaveStyle({
      backgroundColor: "#0d532b",
    });
    expect(screen.getByLabelText("Fri 09:00: 250K tokens")).toHaveStyle({
      backgroundColor: "#6cc482",
    });
  });

  it("exposes an ARIA grid with an accessible name and reachable gridcells", () => {
    const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
    grid[0]![14] = 1_000_000;
    render(<DayHourHeatmap grid={grid} format={formatCompact} />);
    const gridEl = screen.getByRole("grid", { name: "Token usage heatmap by weekday and hour" });
    expect(
      within(gridEl).getByRole("gridcell", { name: "Mon 14:00: 1M tokens" }),
    ).toBeInTheDocument();
  });
});
