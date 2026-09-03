import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import type { Id } from "@convex/_generated/dataModel";
import type { Metric, MetricKey, SummaryResult } from "@convex/lib/types";
import type { ResolvedRange } from "@/lib/range";

// The card's three reads -- `stats.summary`, `stats.breakdowns` (via `useBreakdowns`) and
// `stats.dayHourHeatmap` -- all bottom out in `useQuery`, so one mock dispatching on the query
// stands in for the whole backend. It dispatches on the function *name*: `api.stats.foo` goes
// through a proxy that hands back a fresh object per access, so `===` against it never matches.
const useQueryMock = vi.fn();
vi.mock("convex/react", () => ({ useQuery: (...args: unknown[]) => useQueryMock(...args) }));

import { TimeAnalysisCard } from "./time-analysis-card";

const range: ResolvedRange = {
  kind: "30D",
  from: "2026-08-03",
  to: "2026-09-01",
  days: 30,
  previous: false,
  label: "Last 30 days",
};
const userId = "user1" as Id<"users">;

const summary: SummaryResult = {
  range: { from: range.from, to: range.to },
  previousRange: null,
  tokens: { input: 0, cachedInput: 0, cacheWrite: 0, output: 0, reasoning: 0, total: 0 },
  previousTokens: null,
  metrics: Object.fromEntries(
    (
      ["wallMs", "activeMs", "activeRate", "avgSessionActiveMs", "messages", "sessions"] as const
    ).map((k) => [k, { current: 1, previous: null, change: null } satisfies Metric]),
  ) as Record<MetricKey, Metric>,
  costByKind: { input: 0, cached: 0, output: 0, reasoning: 0 },
  cacheSavingsUsd: 0,
  unpricedModels: [],
  staleRollupDays: 0,
};
const byHour = Array.from({ length: 24 }, (_, h) => (h === 21 ? 100 : 0));
const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));

function renderWithZones(zones: number) {
  // Built once per render, never inside the mock: `useStableQuery` keeps the last value and
  // compares it by reference, so handing back a fresh object each render sets state on every
  // render and React aborts with "Too many re-renders".
  const heatmap = { grid, max: 100, peakHour: 21, peakWeekday: 2, zones };
  const breakdowns = { byHour };
  useQueryMock.mockImplementation((query: unknown) => {
    const name = getFunctionName(query as Parameters<typeof getFunctionName>[0]);
    if (name === "stats:dayHourHeatmap") return heatmap;
    if (name === "stats:breakdowns") return breakdowns;
    return summary;
  });
  render(<TimeAnalysisCard range={range} userId={userId} />);
}

describe("TimeAnalysisCard", () => {
  beforeEach(() => {
    useQueryMock.mockReset();
  });

  it("warns that Peak hour is not one wall-clock hour when machines span zones", () => {
    // Every machine stamps its hour buckets in its own zone and the server sums them into one
    // 7x24 grid. With teammates abroad, "Peak hour: 21:00" is an average of different clocks --
    // a plausible-looking number nobody can act on. The offset is gone before the rollup lands,
    // so it cannot be re-projected; saying so is the only honest option.
    renderWithZones(3);
    const note = screen.getByRole("status");
    expect(note).toHaveTextContent(/3 machine timezones/);
    expect(note).toHaveTextContent(/not a single wall-clock hour/);
  });

  it("stays quiet for a single zone, where Peak hour is a real hour", () => {
    renderWithZones(1);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    // The reading it qualifies is still on screen -- the note's absence is not the card failing.
    expect(screen.getByText("21:00")).toBeInTheDocument();
  });

  it("stays quiet when no machine reported a zone at all", () => {
    renderWithZones(0);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
