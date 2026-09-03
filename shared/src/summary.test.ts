import { describe, expect, it } from "vitest";
import { MAX_QUERY_RANGE_DAYS } from "./constants";
import { daysBetween } from "./days";
import { SummaryResponse, allTimeRange, resolveSummaryRanges } from "./summary";

const TODAY = "2026-09-03";

describe("resolveSummaryRanges", () => {
  it("resolves the three fixed tabs inclusive of today, each with its preceding period", () => {
    const r = resolveSummaryRanges(TODAY, { firstDay: null, lastDay: null });

    expect(r.day.range).toEqual({ from: "2026-09-03", to: "2026-09-03" });
    expect(r.day.previousRange).toEqual({ from: "2026-09-02", to: "2026-09-02" });

    expect(r.week.range).toEqual({ from: "2026-08-28", to: "2026-09-03" });
    expect(r.week.previousRange).toEqual({ from: "2026-08-21", to: "2026-08-27" });

    expect(r.month.range).toEqual({ from: "2026-08-05", to: "2026-09-03" });
    expect(r.month.previousRange).toEqual({ from: "2026-07-06", to: "2026-08-04" });

    // Every previous period is the same length as its range and ends the day before it starts.
    for (const key of ["day", "week", "month"] as const) {
      const { range, previousRange } = r[key];
      expect(previousRange).not.toBeNull();
      expect(daysBetween(previousRange!.from, previousRange!.to)).toBe(
        daysBetween(range.from, range.to),
      );
    }
  });

  it("gives `all` no previous period", () => {
    const r = resolveSummaryRanges(TODAY, { firstDay: "2026-01-01", lastDay: TODAY });
    expect(r.all.range).toEqual({ from: "2026-01-01", to: TODAY });
    expect(r.all.previousRange).toBeNull();
  });
});

describe("allTimeRange", () => {
  it("covers exactly today when there is no data", () => {
    expect(allTimeRange(TODAY, { firstDay: null, lastDay: null })).toEqual({
      from: TODAY,
      to: TODAY,
    });
  });

  it("extends past today for a machine whose day is ahead of the viewer's", () => {
    // A teammate in UTC+14, or any machine with a fast clock, owns the only rollup dated tomorrow.
    const range = allTimeRange(TODAY, { firstDay: "2026-08-01", lastDay: "2026-09-04" });
    expect(range).toEqual({ from: "2026-08-01", to: "2026-09-04" });
  });

  it("never starts after today, even when every rollup is dated ahead of it", () => {
    const range = allTimeRange(TODAY, { firstDay: "2026-09-04", lastDay: "2026-09-04" });
    expect(range).toEqual({ from: TODAY, to: "2026-09-04" });
    expect(daysBetween(range.from, range.to)).toBe(2);
  });

  it("floors the window at MAX_QUERY_RANGE_DAYS measured from `to`, not from today", () => {
    // `to` sits a day ahead of `today`; a floor measured from `today` would span one day too many
    // and every query over the range would throw `bad_range`.
    const range = allTimeRange(TODAY, { firstDay: "2000-01-01", lastDay: "2026-09-04" });
    expect(range.to).toBe("2026-09-04");
    expect(daysBetween(range.from, range.to)).toBe(MAX_QUERY_RANGE_DAYS);
  });
});

describe("SummaryResponse", () => {
  const range = {
    range: { from: TODAY, to: TODAY },
    previousRange: null,
    tokens: { input: 100, cachedInput: 40, cacheWrite: 0, output: 20, reasoning: 5, total: 120 },
    costUsd: 1.5,
    unpricedModels: [],
    sessions: 1,
    changePercent: null,
    topModel: "gpt-5.6-sol",
  };
  const body = {
    ok: true as const,
    serverTime: Date.UTC(2026, 8, 3, 12),
    today: TODAY,
    user: { userId: "u1", name: "Alice" },
    ranges: { day: range, week: range, month: range, all: range },
    quota: {
      value: null,
      source: "none" as const,
      fetchedAt: Date.UTC(2026, 8, 3, 12),
      stale: false,
    },
  };

  it("accepts a well-formed response", () => {
    expect(SummaryResponse.safeParse(body).success).toBe(true);
  });

  it("rejects tokens that break the parser's invariants", () => {
    const broken = {
      ...body,
      ranges: { ...body.ranges, day: { ...range, tokens: { ...range.tokens, cachedInput: 500 } } },
    };
    expect(SummaryResponse.safeParse(broken).success).toBe(false);
  });

  it("rejects a range whose `to` is not a calendar day", () => {
    const broken = {
      ...body,
      ranges: { ...body.ranges, all: { ...range, range: { from: TODAY, to: "2026-02-30" } } },
    };
    expect(SummaryResponse.safeParse(broken).success).toBe(false);
  });
});
