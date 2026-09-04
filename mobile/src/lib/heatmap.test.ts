import { describe, expect, it } from "vitest";
import { activityLevel, activityWeeks, relativeLevel } from "./heatmap";

describe("activityLevel", () => {
  it("uses the fixed bins", () => {
    expect(activityLevel(0)).toBe(0);
    expect(activityLevel(9_999_999)).toBe(1);
    expect(activityLevel(10_000_000)).toBe(2);
    expect(activityLevel(100_000_000)).toBe(3);
    expect(activityLevel(1_000_000_000)).toBe(4);
  });
});

describe("activityWeeks", () => {
  it("starts on the Monday of `from`, marks out-of-range days, and fills tokens", () => {
    // 2026-09-02 is a Wednesday.
    const weeks = activityWeeks("2026-09-02", "2026-09-08", [
      { day: "2026-09-03", tokens: 25_000_000 },
    ]);
    expect(weeks).toHaveLength(2);
    expect(weeks[0]?.[0]).toMatchObject({ day: "2026-08-31", inRange: false, level: 0 });
    expect(weeks[0]?.[2]).toMatchObject({ day: "2026-09-02", inRange: true, level: 0 });
    expect(weeks[0]?.[3]).toMatchObject({ day: "2026-09-03", level: 2, tokens: 25_000_000 });
    expect(weeks[1]?.[1]).toMatchObject({ day: "2026-09-08", inRange: true });
    expect(weeks[1]?.[2]).toMatchObject({ day: "2026-09-09", inRange: false });
  });
});

describe("relativeLevel", () => {
  it("splits into quartiles of the maximum", () => {
    expect(relativeLevel(0, 100)).toBe(0);
    expect(relativeLevel(1, 100)).toBe(1);
    expect(relativeLevel(50, 100)).toBe(2);
    expect(relativeLevel(100, 100)).toBe(4);
    expect(relativeLevel(5, 0)).toBe(0);
  });
});
