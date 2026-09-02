import { describe, expect, it } from "vitest";
import { activityLevel, buildActivityGrid, heatLevel, hourLabel, WEEKDAY_LABELS } from "./heatmap";

describe("activityLevel", () => {
  it.each([
    [0, 0],
    [1, 1],
    [9_999_999, 1],
    [10_000_000, 2],
    [99_999_999, 2],
    [100_000_000, 3],
    [999_999_999, 3],
    [1_000_000_000, 4],
  ])("%s → level %s", (tokens, level) => {
    expect(activityLevel(tokens)).toBe(level);
  });
});

describe("buildActivityGrid", () => {
  const day = (d: string, tokens: number) => ({ day: d, tokens, sessions: 1, costUsd: 0 });
  it("aligns weeks to Monday and pads out-of-range cells", () => {
    // 2026-08-05 is a Wednesday, 2026-08-16 a Sunday.
    const grid = buildActivityGrid("2026-08-05", "2026-08-16", [day("2026-08-05", 5), day("2026-08-10", 20_000_000)]);
    expect(grid.weeks).toHaveLength(2);
    expect(grid.weeks[0]?.map((c) => c.inRange)).toEqual([false, false, true, true, true, true, true]);
    expect(grid.weeks[0]?.[2]).toMatchObject({ day: "2026-08-05", level: 1, tokens: 5 });
    expect(grid.weeks[1]?.[0]).toMatchObject({ day: "2026-08-10", level: 2 });
    expect(grid.weeks[1]?.[6]).toMatchObject({ day: "2026-08-16", level: 0, inRange: true });
    expect(grid.monthLabels).toEqual([{ column: 0, label: "Aug" }]);
  });
  it("labels the column that contains the first day of each month", () => {
    const grid = buildActivityGrid("2026-08-24", "2026-09-13", []);
    expect(grid.weeks).toHaveLength(3);
    expect(grid.monthLabels).toEqual([
      { column: 0, label: "Aug" },
      { column: 1, label: "Sep" },
    ]);
  });
});

describe("heatLevel", () => {
  it("quantises into 5 steps with zero reserved", () => {
    expect(heatLevel(0, 100)).toBe(0);
    expect(heatLevel(1, 100)).toBe(1);
    expect(heatLevel(25, 100)).toBe(1);
    expect(heatLevel(26, 100)).toBe(2);
    expect(heatLevel(100, 100)).toBe(4);
    expect(heatLevel(5, 0)).toBe(0);
  });
  it("labels", () => {
    expect(WEEKDAY_LABELS).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(hourLabel(0)).toBe("00");
    expect(hourLabel(13)).toBe("13");
  });
});
