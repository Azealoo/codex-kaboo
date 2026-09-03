import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Metric, MetricKey, SummaryResult } from "@convex/lib/types";
import { EM_DASH } from "@/lib/format";
import type { ResolvedRange } from "@/lib/range";

// OverviewCards issues its own top-level `stats.summary` query via useStableQuery, which wraps
// convex/react's useQuery — mocking that directly avoids needing a real Convex backend.
const useQueryMock = vi.fn();
vi.mock("convex/react", () => ({ useQuery: (...args: unknown[]) => useQueryMock(...args) }));

import { OverviewCards } from "./overview-cards";

const range: ResolvedRange = {
  kind: "30D",
  from: "2026-08-01",
  to: "2026-08-30",
  days: 30,
  previous: true,
  label: "Last 30 days",
};
const zero: Metric = { current: 0, previous: null, change: null };

function summaryWith(overrides: Partial<Record<MetricKey, Metric>>): SummaryResult {
  return {
    range: { from: range.from, to: range.to },
    previousRange: null,
    tokens: { input: 0, cachedInput: 0, cacheWrite: 0, output: 0, reasoning: 0, total: 0 },
    previousTokens: null,
    metrics: { ...overrides } as Record<MetricKey, Metric>,
    costByKind: { input: 0, cached: 0, output: 0, reasoning: 0 },
    cacheSavingsUsd: 0,
    unpricedModels: [],
    staleRollupDays: 0,
  };
}

describe("OverviewCards", () => {
  beforeEach(() => {
    useQueryMock.mockReset();
  });

  it("renders an em dash for an undefined cache hit rate, not a fabricated 0.0%", () => {
    // A range with no input tokens at all: cacheHitRate's denominator is zero, so the rate is
    // undefined — distinct from a genuine 0% hit rate, and must not render as one.
    useQueryMock.mockReturnValue(
      summaryWith({
        cacheHitRate: { current: null, previous: null, change: null },
        tokensPerTurn: zero,
        avgSessionActiveMs: zero,
        ttftP50Ms: zero,
        compactions: zero,
        costUsd: zero,
      }),
    );
    render(<OverviewCards range={range} view="efficiency" />);
    // Scope to the Cache hit rate card itself — the cost structure bar below it legitimately
    // renders its own "0.0%" segment shares for an all-zero costByKind, which isn't this metric.
    const card = screen
      .getByText("Cache hit rate")
      .closest('[data-slot="card"]') as HTMLElement | null;
    expect(card).not.toBeNull();
    expect(within(card!).getByText(EM_DASH)).toBeInTheDocument();
    expect(within(card!).queryByText("0.0%")).not.toBeInTheDocument();
  });

  // The backend counts stale rollups; this pins that the count is actually wired to a surface a
  // human sees. Silent is the whole failure mode — a number computed and never shown is the bug.
  it("says so when the range contains rollups an older version computed", () => {
    // The efficiency view for the same reason as the test above: the volume view mounts QuotaCard,
    // which issues its own query that this single mock cannot answer.
    const metrics = {
      cacheHitRate: zero,
      tokensPerTurn: zero,
      avgSessionActiveMs: zero,
      ttftP50Ms: zero,
      compactions: zero,
      costUsd: zero,
    } as Partial<Record<MetricKey, Metric>>;
    useQueryMock.mockReturnValue({ ...summaryWith(metrics), staleRollupDays: 2 });
    const { unmount } = render(<OverviewCards range={range} view="efficiency" />);
    expect(screen.getByRole("status")).toHaveTextContent("rollups:rebuildAll");
    expect(screen.getByRole("status")).toHaveTextContent("2 days");
    unmount();

    useQueryMock.mockReturnValue(summaryWith(metrics));
    render(<OverviewCards range={range} view="efficiency" />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
