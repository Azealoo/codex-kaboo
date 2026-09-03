import { describe, expect, it } from "vitest";
import {
  formatCompact,
  formatDateTime,
  formatDay,
  formatDayShort,
  formatDeltaPercent,
  formatDurationMs,
  formatHours,
  formatInt,
  formatMonth,
  formatNullable,
  formatPercent,
  formatRelative,
  formatResetsIn,
  formatUsd,
} from "./format";

describe("formatInt", () => {
  it.each([
    [0, "0"],
    [999, "999"],
    [1000, "1,000"],
    [1234567.6, "1,234,568"],
    [-42, "-42"],
    [NaN, "—"],
    [Infinity, "—"],
    [-Infinity, "—"],
  ])("%s → %s", (input, expected) => {
    expect(formatInt(input)).toBe(expected);
  });
});

describe("formatCompact", () => {
  it.each([
    [0, "0"],
    [999, "999"],
    [1000, "1K"],
    [1234, "1.2K"],
    [12900, "12.9K"],
    [999999, "1M"],
    [1_500_000, "1.5M"],
    [5_600_000_000, "5.6B"],
    [2_100_000_000_000, "2.1T"],
    [-1234, "-1.2K"],
    [NaN, "—"],
    [Infinity, "—"],
    [-Infinity, "—"],
  ])("%s → %s", (input, expected) => {
    expect(formatCompact(input)).toBe(expected);
  });
});

describe("formatUsd", () => {
  it.each([
    [0, "$0.00"],
    [0.004, "<$0.01"],
    [0.01, "$0.01"],
    [12.345, "$12.35"],
    [99.999, "$100"],
    [100, "$100"],
    [1234.5, "$1,235"],
    [-3.5, "-$3.50"],
    [NaN, "—"],
    [Infinity, "—"],
    [-Infinity, "—"],
  ])("%s → %s", (input, expected) => {
    expect(formatUsd(input)).toBe(expected);
  });
});

describe("formatPercent / formatDeltaPercent", () => {
  it("formats fractions", () => {
    expect(formatPercent(0.4231)).toBe("42.3%");
    expect(formatPercent(1)).toBe("100.0%");
    expect(formatPercent(0.4231, 0)).toBe("42%");
    expect(formatPercent(null)).toBe("—");
  });
  it("formats signed deltas with a real minus sign", () => {
    expect(formatDeltaPercent(0.25)).toBe("+25.0%");
    expect(formatDeltaPercent(-0.032)).toBe("−3.2%");
    expect(formatDeltaPercent(0)).toBe("0.0%");
    expect(formatDeltaPercent(null)).toBe("—");
  });
});

describe("formatDurationMs", () => {
  it.each([
    [0, "0s"],
    [-5, "0s"],
    [850, "850ms"],
    [12_000, "12s"],
    [725_000, "12m 5s"],
    [11_520_000, "3h 12m"],
    [187_200_000, "2d 4h"],
    [86_400_000, "1d 0h"],
  ])("%s → %s", (input, expected) => {
    expect(formatDurationMs(input)).toBe(expected);
  });
  it("formats hours with one decimal", () => {
    expect(formatHours(45_000_000)).toBe("12.5h");
    expect(formatHours(0)).toBe("0h");
    expect(formatHours(360_000_000)).toBe("100h");
  });
  it("returns an em dash for non-finite formatHours input", () => {
    expect(formatHours(NaN)).toBe("—");
    expect(formatHours(Infinity)).toBe("—");
    expect(formatHours(-Infinity)).toBe("—");
  });
});

describe("formatRelative / formatResetsIn", () => {
  const now = Date.UTC(2026, 8, 1, 12, 0, 0);
  it("describes elapsed time coarsely", () => {
    expect(formatRelative(now - 10_000, now)).toBe("just now");
    expect(formatRelative(now - 3 * 60_000, now)).toBe("3 min ago");
    expect(formatRelative(now - 2 * 3_600_000, now)).toBe("2 h ago");
    expect(formatRelative(now - 5 * 86_400_000, now)).toBe("5 d ago");
    expect(formatRelative(now + 60_000, now)).toBe("just now");
  });
  it("describes the quota reset", () => {
    expect(formatResetsIn(null, now)).toBe("Reset time unknown");
    expect(formatResetsIn(now - 1, now)).toBe("Reset passed");
    expect(formatResetsIn(now + 30_000, now)).toBe("Resets in under a minute");
    expect(formatResetsIn(now + 187_200_000, now)).toBe("Resets in 2d 4h");
  });
});

describe("day formatting", () => {
  it("formats day strings without touching the local zone", () => {
    expect(formatDay("2026-09-01")).toBe("Sep 1, 2026");
    expect(formatDayShort("2026-12-25")).toBe("Dec 25");
    expect(formatMonth("2026-02-03")).toBe("Feb 2026");
  });
  it("formats a timestamp in local time as `Mon D, HH:MM`", () => {
    const d = new Date(2026, 8, 1, 14, 5);
    expect(formatDateTime(d.getTime())).toBe("Sep 1, 14:05");
  });
  it("formatNullable falls back to an em dash", () => {
    expect(formatNullable(null, formatCompact)).toBe("—");
    expect(formatNullable(1234, formatCompact)).toBe("1.2K");
  });
});
