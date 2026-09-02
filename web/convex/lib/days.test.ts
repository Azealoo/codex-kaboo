import { describe, expect, it } from "vitest";
import { addDays } from "../../../shared/src/days";
import { assertRange, resolvePeriods } from "./days";

describe("assertRange", () => {
  it("accepts an inclusive range and returns it", () => {
    expect(assertRange("2026-08-03", "2026-09-01")).toEqual({
      from: "2026-08-03",
      to: "2026-09-01",
    });
  });
  it("rejects invalid days, reversed ranges and spans over 1100 days", () => {
    expect(() => assertRange("2026-02-30", "2026-03-01")).toThrow();
    expect(() => assertRange("2026-03-02", "2026-03-01")).toThrow();
    expect(() => assertRange("2020-01-01", addDays("2020-01-01", 1099))).not.toThrow();
    expect(() => assertRange("2020-01-01", addDays("2020-01-01", 1100))).toThrow();
  });
  it("reports code bad_range with the offending days", () => {
    try {
      assertRange("bogus", "2026-03-01");
      expect.unreachable("assertRange must throw");
    } catch (error) {
      expect((error as { data: unknown }).data).toEqual({
        code: "bad_range",
        from: "bogus",
        to: "2026-03-01",
      });
    }
  });
});

describe("resolvePeriods", () => {
  it("computes the previous period of equal length ending the day before `from`", () => {
    expect(resolvePeriods("2026-03-01", "2026-03-07", undefined)).toEqual({
      range: { from: "2026-03-01", to: "2026-03-07" },
      previousRange: { from: "2026-02-22", to: "2026-02-28" },
    });
  });
  it("handles the leap day and year boundaries", () => {
    expect(resolvePeriods("2024-03-01", "2024-03-01", true).previousRange).toEqual({
      from: "2024-02-29",
      to: "2024-02-29",
    });
    expect(resolvePeriods("2026-01-01", "2026-01-31", true).previousRange).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    });
  });
  it("omits the previous period when previous is false", () => {
    expect(resolvePeriods("2026-03-01", "2026-03-07", false).previousRange).toBeNull();
  });
});
