import { describe, expect, it } from "vitest";
import { DEFAULT_PRESET, isCustom, presetLabel, resolveRange, type RangeParams } from "./range";

const preset = (range: RangeParams["range"]): RangeParams => ({ range, from: null, to: null });

describe("resolveRange presets", () => {
  it("1D is today only, with a previous period", () => {
    expect(resolveRange(preset("1D"), "2026-09-01")).toEqual({
      kind: "1D",
      from: "2026-09-01",
      to: "2026-09-01",
      days: 1,
      previous: true,
      label: "Today",
    });
  });
  it("30D crosses a month boundary", () => {
    const r = resolveRange(preset("30D"), "2026-03-01");
    expect(r?.from).toBe("2026-01-31");
    expect(r?.to).toBe("2026-03-01");
    expect(r?.days).toBe(30);
  });
  it("30D respects leap years", () => {
    expect(resolveRange(preset("30D"), "2024-03-01")?.from).toBe("2024-02-01");
  });
  it("7D crosses a year boundary", () => {
    expect(resolveRange(preset("7D"), "2026-01-01")?.from).toBe("2025-12-26");
  });
  it("90D", () => {
    const r = resolveRange(preset("90D"), "2026-09-01");
    expect(r?.from).toBe("2026-06-04");
    expect(r?.label).toBe("Last 90 days");
  });
});

describe("resolveRange ALL", () => {
  it("is unresolved until bounds are known", () => {
    expect(resolveRange(preset("ALL"), "2026-09-01")).toBeNull();
    expect(resolveRange(preset("ALL"), "2026-09-01", null)).toBeNull();
  });
  it("uses the first data day and hides deltas", () => {
    const r = resolveRange(preset("ALL"), "2026-09-01", {
      firstDay: "2026-07-10",
      lastDay: "2026-09-01",
    });
    expect(r).toEqual({
      kind: "ALL",
      from: "2026-07-10",
      to: "2026-09-01",
      days: 54,
      previous: false,
      label: "All time",
    });
  });
  it("falls back to today when there is no data", () => {
    const r = resolveRange(preset("ALL"), "2026-09-01", { firstDay: null, lastDay: null });
    expect(r?.from).toBe("2026-09-01");
    expect(r?.previous).toBe(false);
  });
  it("clamps to the server's 1100-day cap", () => {
    const r = resolveRange(preset("ALL"), "2026-09-01", {
      firstDay: "2020-01-01",
      lastDay: "2026-09-01",
    });
    expect(r?.days).toBe(1100);
    expect(r?.from).toBe("2023-08-29");
  });
  it("never inverts when a machine-local firstDay is ahead of the viewer's today", () => {
    // Reviewer's case: a teammate in UTC+13/+14 can legitimately own the only rollup, dated
    // `today + 1` from this viewer's browser clock. Unclamped, `from` (bounds.firstDay) landed
    // after `to` (today), and the server's assertRange throws `bad_range` for every query on the
    // page. `from` must never be pushed past `today`, and `to` must extend to cover a day that is
    // genuinely ahead of the viewer rather than silently dropping it.
    const r = resolveRange(preset("ALL"), "2026-09-02", {
      firstDay: "2026-09-03",
      lastDay: "2026-09-03",
    });
    expect(r).toEqual({
      kind: "ALL",
      from: "2026-09-02",
      to: "2026-09-03",
      days: 2,
      previous: false,
      label: "All time",
    });
    expect(r!.from <= r!.to).toBe(true);
  });
  it("leaves the ordinary case where firstDay is before today unchanged", () => {
    const r = resolveRange(preset("ALL"), "2026-09-02", {
      firstDay: "2026-08-01",
      lastDay: "2026-09-01",
    });
    expect(r).toEqual({
      kind: "ALL",
      from: "2026-08-01",
      to: "2026-09-02",
      days: 33,
      previous: false,
      label: "All time",
    });
  });
});

describe("resolveRange custom", () => {
  it("uses from/to when both are valid", () => {
    const r = resolveRange(
      { range: DEFAULT_PRESET, from: "2026-08-01", to: "2026-08-15" },
      "2026-09-01",
    );
    expect(r).toEqual({
      kind: "custom",
      from: "2026-08-01",
      to: "2026-08-15",
      days: 15,
      previous: true,
      label: "Aug 1 – Aug 15, 2026",
    });
  });
  it("clamps `to` to today", () => {
    const r = resolveRange(
      { range: DEFAULT_PRESET, from: "2026-08-20", to: "2026-12-31" },
      "2026-09-01",
    );
    expect(r?.to).toBe("2026-09-01");
    expect(r?.kind).toBe("custom");
  });
  it("falls back to 30D when the span exceeds 400 days", () => {
    const r = resolveRange(
      { range: DEFAULT_PRESET, from: "2024-01-01", to: "2026-09-01" },
      "2026-09-01",
    );
    expect(r?.kind).toBe("30D");
  });
  it("falls back to 30D for invalid days or from > to", () => {
    expect(
      resolveRange({ range: "7D", from: "2026-02-30", to: "2026-03-01" }, "2026-09-01")?.kind,
    ).toBe("30D");
    expect(
      resolveRange({ range: "7D", from: "2026-03-05", to: "2026-03-01" }, "2026-09-01")?.kind,
    ).toBe("30D");
    expect(
      resolveRange({ range: "7D", from: "2026-09-05", to: "2026-09-06" }, "2026-09-01")?.kind,
    ).toBe("30D");
  });
  it("isCustom requires both ends", () => {
    expect(isCustom({ range: "7D", from: "2026-08-01", to: null })).toBe(false);
    expect(isCustom({ range: "7D", from: "2026-08-01", to: "2026-08-02" })).toBe(true);
  });
});

describe("presetLabel", () => {
  it("names every preset", () => {
    expect(presetLabel("1D")).toBe("Today");
    expect(presetLabel("7D")).toBe("Last 7 days");
    expect(presetLabel("30D")).toBe("Last 30 days");
    expect(presetLabel("90D")).toBe("Last 90 days");
    expect(presetLabel("ALL")).toBe("All time");
  });
});
