import { describe, expect, it } from "vitest";
import {
  addDays,
  bucketFor,
  bucketStart,
  compareDays,
  dayHourIn,
  daysBetween,
  dayToUtcMs,
  eachBucket,
  eachDay,
  isValidDay,
  monthStart,
  previousPeriod,
  utcMsToDay,
  weekStart,
  weekdayOf,
} from "./days";

describe("isValidDay", () => {
  it("accepts real calendar days and rejects the rest", () => {
    expect(isValidDay("2024-02-29")).toBe(true);
    expect(isValidDay("2023-02-29")).toBe(false);
    expect(isValidDay("2026-13-01")).toBe(false);
    expect(isValidDay("2026-04-31")).toBe(false);
    expect(isValidDay("1999-12-31")).toBe(false);
    expect(isValidDay("2100-01-01")).toBe(false);
    expect(isValidDay("2026-9-1")).toBe(false);
    expect(isValidDay("garbage")).toBe(false);
  });
});

describe("day arithmetic", () => {
  it("converts to and from UTC ms", () => {
    expect(dayToUtcMs("2026-09-01")).toBe(Date.UTC(2026, 8, 1));
    expect(utcMsToDay(Date.UTC(2026, 8, 1, 23, 59))).toBe("2026-09-01");
  });
  it("adds days across month, year and leap boundaries", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2024-02-29", 1)).toBe("2024-03-01");
    expect(addDays("2024-12-31", 1)).toBe("2025-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
  it("counts inclusive days and returns 0 for inverted ranges", () => {
    expect(daysBetween("2026-01-01", "2026-01-31")).toBe(31);
    expect(daysBetween("2026-01-01", "2026-01-01")).toBe(1);
    expect(daysBetween("2026-01-02", "2026-01-01")).toBe(0);
    expect(eachDay("2026-02-27", "2026-03-02")).toEqual([
      "2026-02-27",
      "2026-02-28",
      "2026-03-01",
      "2026-03-02",
    ]);
    expect(eachDay("2026-01-02", "2026-01-01")).toEqual([]);
  });
  it("compares lexically", () => {
    expect(compareDays("2026-01-01", "2026-01-02")).toBe(-1);
    expect(compareDays("2026-01-02", "2026-01-02")).toBe(0);
    expect(compareDays("2026-01-03", "2026-01-02")).toBe(1);
  });
});

describe("previousPeriod", () => {
  it("returns the same-length period immediately before", () => {
    expect(previousPeriod("2026-03-01", "2026-03-30")).toEqual({
      from: "2026-01-30",
      to: "2026-02-28",
    });
    expect(previousPeriod("2024-03-01", "2024-03-01")).toEqual({
      from: "2024-02-29",
      to: "2024-02-29",
    });
    expect(previousPeriod("2026-01-01", "2026-01-07")).toEqual({
      from: "2025-12-25",
      to: "2025-12-31",
    });
  });
});

describe("buckets", () => {
  it("knows weekdays with Monday = 0", () => {
    expect(weekdayOf("2026-09-01")).toBe(1); // Tuesday
    expect(weekdayOf("2026-08-30")).toBe(6); // Sunday
    expect(weekStart("2026-09-01")).toBe("2026-08-31");
    expect(weekStart("2026-08-31")).toBe("2026-08-31");
    expect(monthStart("2026-09-17")).toBe("2026-09-01");
  });
  it("enumerates bucket starts covering the range", () => {
    expect(bucketStart("2026-09-01", "day")).toBe("2026-09-01");
    expect(eachBucket("2026-08-30", "2026-09-02", "week")).toEqual(["2026-08-24", "2026-08-31"]);
    expect(eachBucket("2025-12-15", "2026-02-03", "month")).toEqual([
      "2025-12-01",
      "2026-01-01",
      "2026-02-01",
    ]);
    expect(eachBucket("2026-01-30", "2026-02-01", "day")).toEqual([
      "2026-01-30",
      "2026-01-31",
      "2026-02-01",
    ]);
  });
  it("picks the granularity from the span", () => {
    expect(bucketFor(1)).toBe("day");
    expect(bucketFor(120)).toBe("day");
    expect(bucketFor(121)).toBe("week");
    expect(bucketFor(730)).toBe("week");
    expect(bucketFor(731)).toBe("month");
  });
});

describe("dayHourIn", () => {
  it("formats in the given zone with h23 hours", () => {
    expect(dayHourIn(Date.UTC(2026, 0, 1, 0, 0, 0), "UTC")).toEqual({ day: "2026-01-01", hour: 0 });
    expect(dayHourIn(Date.UTC(2026, 0, 1, 0, 0, 0), "Asia/Tokyo")).toEqual({
      day: "2026-01-01",
      hour: 9,
    });
    expect(dayHourIn(Date.UTC(2026, 0, 1, 7, 59, 59), "America/Los_Angeles")).toEqual({
      day: "2025-12-31",
      hour: 23,
    });
    expect(dayHourIn(Date.UTC(2026, 0, 1, 8, 0, 0), "America/Los_Angeles")).toEqual({
      day: "2026-01-01",
      hour: 0,
    });
  });
  it("handles the DST switch (2026-03-08 in Los Angeles)", () => {
    expect(dayHourIn(Date.UTC(2026, 2, 8, 9, 30, 0), "America/Los_Angeles")).toEqual({
      day: "2026-03-08",
      hour: 1,
    });
    expect(dayHourIn(Date.UTC(2026, 2, 8, 10, 30, 0), "America/Los_Angeles")).toEqual({
      day: "2026-03-08",
      hour: 3,
    });
  });
  it("falls back instead of throwing for an invalid or missing zone", () => {
    const a = dayHourIn(Date.UTC(2026, 5, 15, 12, 0, 0), "Mars/Olympus");
    const b = dayHourIn(Date.UTC(2026, 5, 15, 12, 0, 0), undefined);
    for (const r of [a, b]) {
      expect(r.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.hour).toBeGreaterThanOrEqual(0);
      expect(r.hour).toBeLessThanOrEqual(23);
    }
    expect(a).toEqual(b);
  });
});
