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
    // Two subscriptions share one mock: the history query is told apart by its `sinceMs` arg.
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) =>
      args !== "skip" && typeof args === "object" && args !== null && "sinceMs" in args
        ? { points: [], sinceMs: 0, truncated: false }
        : quotaReading,
    );
    const quotaReading = {
      usedPercent: 42,
      windowMinutes: 10_080,
      resetsAt: NOW + 100_000,
      planType: "plus",
      limitId: "primary",
      observedAt: NOW + 63_072_000_000, // a fast RTC reporting ~2 years ahead ("2028")
      receivedAt: NOW - 3 * 3_600_000, // the server actually received it 3 h ago
      machine: { machineId: "m1", label: "MacBook" },
      user: { userId: "u1" as Id<"users">, name: "Alex", imageUrl: null },
    };

    const { container } = render(<QuotaCard />);

    expect(screen.getByText("Stale")).toBeInTheDocument();
    expect(container.textContent).toContain("as of 3 h ago");
    expect(container.textContent).not.toContain("as of just now");
  });

  it("draws the 7-day history with the day-over-day change and marks the weekly reset", () => {
    const day = 86_400_000;
    const reading = {
      usedPercent: 30,
      windowMinutes: 10_080,
      resetsAt: NOW + 100_000,
      planType: "team",
      limitId: "primary",
      observedAt: NOW - 1000,
      receivedAt: NOW - 1000,
      machine: { machineId: "m1", label: "MacBook" },
      user: { userId: "u1" as Id<"users">, name: "Alex", imageUrl: null },
    };
    const point = (t: number, usedPercent: number) => ({
      t,
      usedPercent,
      resetsAt: null,
      machineId: "m1",
      label: "MacBook",
    });
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) =>
      args !== "skip" && typeof args === "object" && args !== null && "sinceMs" in args
        ? {
            points: [
              point(NOW - 3 * day, 70),
              point(NOW - 2 * day, 90),
              point(NOW - 1.5 * day, 5), // the weekly reset
              point(NOW - 1.1 * day, 12),
              point(NOW - 1000, 30),
            ],
            sinceMs: NOW - 7 * day,
            truncated: false,
          }
        : reading,
    );
    const { container } = render(<QuotaCard />);
    expect(
      screen.getByRole("img", { name: /over the last 7 days: 5 readings, now 30%/ }),
    ).toBeInTheDocument();
    expect(container.querySelectorAll('[data-testid="quota-reset"]')).toHaveLength(1);
    expect(container.textContent).toContain("Last 7 days · 5 readings · +18 pts since yesterday");
  });

  it("omits the history strip while it is empty", () => {
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) =>
      args !== "skip" && typeof args === "object" && args !== null && "sinceMs" in args
        ? { points: [], sinceMs: 0, truncated: false }
        : {
            usedPercent: 10,
            windowMinutes: 10_080,
            resetsAt: NOW + 100_000,
            planType: "team",
            limitId: "primary",
            observedAt: NOW,
            receivedAt: NOW,
            machine: { machineId: "m1", label: "MacBook" },
            user: { userId: "u1" as Id<"users">, name: "Alex", imageUrl: null },
          },
    );
    render(<QuotaCard />);
    expect(screen.queryByText(/readings/)).not.toBeInTheDocument();
  });
});
