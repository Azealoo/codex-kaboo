import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";

const NOW = 1_756_800_000_000;

const useQueryMock = vi.fn();
vi.mock("convex/react", () => ({ useQuery: (...args: unknown[]) => useQueryMock(...args) }));
vi.mock("@/hooks/use-now", () => ({ useNow: () => NOW }));

import { QuotaCard } from "./quota-card";

describe("QuotaCard staleness", () => {
  // Regression: this is the display half of the wave's Fix 2. The STORAGE gate for
  // `machine.lastRateLimit` already moved to the server clock (`receivedAt`), but the badge and
  // "as of" line still compared the client-reported `observedAt` against the viewer's clock. A
  // machine with a fast RTC that reports `observedAt` far in the future makes `now - observedAt`
  // negative, which never exceeds STALE_AFTER_MS — so the gauge claims freshness precisely when
  // it is most wrong. Both must key off `receivedAt`, the only clock the server can vouch for.
  it("flags a snapshot as stale from receivedAt, and reports its age from receivedAt, even when observedAt is far in the future", () => {
    useQueryMock.mockReturnValue({
      usedPercent: 42,
      windowMinutes: 10_080,
      resetsAt: NOW + 100_000,
      planType: "plus",
      limitId: "primary",
      observedAt: NOW + 63_072_000_000, // a fast RTC reporting ~2 years ahead ("2028")
      receivedAt: NOW - 3 * 3_600_000, // the server actually received it 3 h ago
      machine: { machineId: "m1", label: "MacBook" },
      user: { userId: "u1" as Id<"users">, name: "Alex", imageUrl: null },
    });

    const { container } = render(<QuotaCard />);

    expect(screen.getByText("Stale")).toBeInTheDocument();
    expect(container.textContent).toContain("as of 3 h ago");
    expect(container.textContent).not.toContain("as of just now");
  });
});
