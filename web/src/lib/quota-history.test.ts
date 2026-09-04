import { describe, expect, it } from "vitest";
import type { QuotaHistoryPoint } from "@convex/lib/types";
import {
  historySince,
  resetMarkers,
  sparklinePath,
  sparklinePoints,
  usedDelta,
} from "./quota-history";

const p = (t: number, usedPercent: number): QuotaHistoryPoint => ({
  t,
  usedPercent,
  resetsAt: null,
  machineId: "m",
  label: "m",
});

describe("sparklinePoints / sparklinePath", () => {
  it("maps time to x and used-percent to y (100% at the top), clamping out-of-range values", () => {
    const pts = sparklinePoints([p(0, 0), p(50, 50), p(100, 140), p(200, 10)], 0, 100, 200, 40);
    expect(pts).toEqual([
      { x: 0, y: 40 },
      { x: 100, y: 20 },
      { x: 200, y: 0 },
    ]);
    expect(sparklinePath(pts)).toBe("M0.0 40.0 L100.0 20.0 L200.0 0.0");
  });
  it("draws nothing for an empty span or a single point", () => {
    expect(sparklinePoints([p(1, 1)], 5, 5, 10, 10)).toEqual([]);
    expect(sparklinePath([{ x: 1, y: 1 }])).toBe("");
  });
});

describe("usedDelta", () => {
  const day = 86_400_000;
  it("compares the latest reading with the newest one at least a window older", () => {
    const history = [p(0, 10), p(day * 0.5, 20), p(day * 1.2, 30), p(day * 2, 42)];
    expect(usedDelta(history, day)).toEqual({ latest: 42, earlier: 20, delta: 22 });
  });
  it("is null when the history does not reach back a full window", () => {
    expect(usedDelta([p(0, 10), p(1000, 12)], day)).toBeNull();
    expect(usedDelta([], day)).toBeNull();
  });
});

describe("resetMarkers", () => {
  it("marks sharp drops (the weekly reset) and ignores ordinary decreases", () => {
    const history = [p(1, 60), p(2, 75), p(3, 3), p(4, 8), p(5, 6)];
    expect(resetMarkers(history)).toEqual([3]);
  });
});

describe("historySince", () => {
  it("floors to the hour so the subscription args are stable within it", () => {
    const now = Date.UTC(2026, 8, 4, 10, 47, 13);
    expect(historySince(now, 7)).toBe(Date.UTC(2026, 8, 4, 10) - 7 * 86_400_000);
    expect(historySince(now + 60_000, 7)).toBe(historySince(now, 7));
  });
});
