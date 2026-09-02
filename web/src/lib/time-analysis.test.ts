import { describe, expect, it } from "vitest";
import { peakHour, timeAnalysisRows } from "./time-analysis";
import type { Metric, MetricKey, SummaryResult } from "@convex/lib/types";

function summaryWith(values: Partial<Record<MetricKey, number>>): SummaryResult {
  const metrics = {} as Record<MetricKey, Metric>;
  for (const [k, v] of Object.entries(values)) metrics[k as MetricKey] = { current: v, previous: null, change: null };
  return {
    range: { from: "2026-08-03", to: "2026-09-01" },
    previousRange: null,
    tokens: { input: 0, cachedInput: 0, cacheWrite: 0, output: 0, reasoning: 0, total: 0 },
    previousTokens: null,
    metrics,
    costByKind: { input: 0, cached: 0, output: 0, reasoning: 0 },
    cacheSavingsUsd: 0,
    unpricedModels: [],
  };
}

describe("time analysis", () => {
  it("finds the peak hour, ignoring all-zero days", () => {
    const byHour = Array.from({ length: 24 }, () => 0);
    expect(peakHour(byHour)).toBeNull();
    byHour[14] = 5;
    byHour[9] = 7;
    expect(peakHour(byHour)).toBe(9);
  });
  it("produces the seven rows with formatted values", () => {
    const summary = summaryWith({
      wallMs: 36_000_000,
      activeMs: 18_000_000,
      activeRate: 0.5,
      avgSessionActiveMs: 3_600_000,
      messages: 40,
      sessions: 5,
    });
    const byHour = Array.from({ length: 24 }, (_, h) => (h === 21 ? 100 : 0));
    const rows = timeAnalysisRows(summary, byHour, { grid: [], max: 0, peakHour: 21, peakWeekday: 2 });
    expect(rows.map((r) => [r.label, r.value])).toEqual([
      ["Total hours", "10h"],
      ["Active hours", "5h"],
      ["Active rate", "50.0%"],
      ["Avg session", "1h 0m"],
      ["Messages / session", "8.0"],
      ["Peak hour", "21:00"],
      ["Most active day", "Wed"],
    ]);
  });
});
