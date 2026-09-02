import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedRange } from "@/lib/range";

// TrendSection composes the real TrendChart/StackedBarChart (Recharts) once data resolves,
// and Recharts never mounts in jsdom (no ResizeObserver). Keeping `useQuery` permanently
// `undefined` here exercises the loading skeleton and the query wiring — the "non-chart"
// parts of this component — without ever reaching the chart-rendering branch.
const useQueryMock = vi.fn();
vi.mock("convex/react", () => ({ useQuery: (...args: unknown[]) => useQueryMock(...args) }));

import { TrendSection } from "./trend-section";

function makeRange(days: number): ResolvedRange {
  return { kind: "custom", from: "2026-08-01", to: "2026-09-02", days, previous: true, label: `${days} days` };
}

describe("TrendSection", () => {
  beforeEach(() => {
    useQueryMock.mockReset();
    useQueryMock.mockReturnValue(undefined);
  });

  it("shows a skeleton in place of both charts while trends are loading", () => {
    const { container } = render(<TrendSection range={makeRange(30)} />);
    expect(screen.getByText("Token usage trend")).toBeInTheDocument();
    expect(screen.getByText("Tokens by model")).toBeInTheDocument();
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(2);
  });

  it.each([
    [30, "day"],
    [200, "week"],
  ])("requests the %d-day trend with the %s bucket", (days, bucket) => {
    const range = makeRange(days);
    render(<TrendSection range={range} />);
    const trendsCalls = useQueryMock.mock.calls.filter(
      ([, args]) => args !== undefined && args !== null && typeof args === "object" && "bucket" in args,
    );
    expect(trendsCalls).toHaveLength(1);
    expect(trendsCalls[0]?.[1]).toEqual({ from: range.from, to: range.to, bucket });
  });
});
