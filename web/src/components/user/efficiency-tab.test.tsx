import { render, screen } from "@testing-library/react";
import { ConvexError } from "convex/values";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { ResolvedRange } from "@/lib/range";

// EfficiencyTab's nine-card grid issues its own top-level `stats.summary` query. Keeping
// `useQuery` throwing exercises the "query fails" path without needing a real Convex backend.
const useQueryMock = vi.fn();
vi.mock("convex/react", () => ({ useQuery: (...args: unknown[]) => useQueryMock(...args) }));

import { EfficiencyTab } from "./efficiency-tab";

const range: ResolvedRange = {
  kind: "30D",
  from: "2026-08-01",
  to: "2026-08-30",
  days: 30,
  previous: true,
  label: "Last 30 days",
};
const userId = "user1" as Id<"users">;

describe("EfficiencyTab", () => {
  beforeEach(() => {
    useQueryMock.mockReset();
    useQueryMock.mockImplementation(() => {
      throw new ConvexError({ code: "range_too_large" });
    });
  });

  it("shows a section-sized fallback instead of crashing when stats.summary throws", () => {
    render(<EfficiencyTab range={range} userId={userId} />);
    expect(screen.getByText("Efficiency stats could not load")).toBeInTheDocument();
    expect(screen.queryByText("Cost structure")).not.toBeInTheDocument();
  });
});
