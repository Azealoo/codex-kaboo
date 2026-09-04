import type { TrendsResult } from "@convex/lib/types";
import { OTHER_KEY } from "@shared/constants";
import { formatDayShort, formatMonth } from "@shared/format";
import { colorFor, OTHER_COLOR, type ColorMap } from "./colors";

export type Series = { key: string; label: string; color: string };
export type StackedBar = { x: string; label: string; values: number[]; total: number };
export type StackedData = {
  series: Series[];
  bars: StackedBar[];
  max: number;
  peak: { label: string; total: number } | null;
};

export function bucketLabel(bucket: string, granularity: "day" | "week" | "month"): string {
  return granularity === "month" ? formatMonth(bucket) : formatDayShort(bucket);
}

function rank(totals: Map<string, number>): string[] {
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k]) => k);
}

function build(
  trends: TrendsResult,
  entities: string[],
  labelOf: (e: string) => string,
  colorOf: (e: string) => string,
  valueOf: (p: TrendsResult["points"][number], e: string) => number,
  rest: string[] = [],
): StackedData {
  const series: Series[] = entities.map((e) => ({ key: e, label: labelOf(e), color: colorOf(e) }));
  if (rest.length > 0) series.push({ key: OTHER_KEY, label: "Other", color: OTHER_COLOR });
  let max = 0;
  let peak: StackedData["peak"] = null;
  const bars = trends.points.map((p) => {
    const values = entities.map((e) => valueOf(p, e));
    if (rest.length > 0) values.push(rest.reduce((acc, e) => acc + valueOf(p, e), 0));
    const total = values.reduce((a, b) => a + b, 0);
    const label = bucketLabel(p.bucket, trends.bucket);
    if (total > max) max = total;
    if (total > 0 && (peak === null || total > peak.total)) peak = { label, total };
    return { x: p.bucket, label, values, total };
  });
  return { series, bars, max, peak };
}

/** Tokens per bucket stacked by user (every user a series). */
export function stackByUser(trends: TrendsResult, colors: ColorMap): StackedData {
  const totals = new Map<string, number>();
  for (const p of trends.points)
    for (const u of p.byUser) totals.set(u.key, (totals.get(u.key) ?? 0) + u.tokens);
  const names = new Map(trends.users.map((u) => [u.userId as string, u.name]));
  return build(
    trends,
    rank(totals),
    (id) => names.get(id) ?? id,
    (id) => colorFor(colors, id),
    (p, id) => p.byUser.find((u) => u.key === id)?.tokens ?? 0,
  );
}

/** Tokens per bucket stacked by model, top `topN` plus Other (a server `(other)` row always folds). */
export function stackByModel(trends: TrendsResult, colors: ColorMap, topN = 5): StackedData {
  const totals = new Map<string, number>();
  for (const p of trends.points)
    for (const m of p.byModel) totals.set(m.key, (totals.get(m.key) ?? 0) + m.tokens);
  const ordered = rank(totals);
  const rankable = ordered.filter((k) => k !== OTHER_KEY);
  const hasSentinel = rankable.length !== ordered.length;
  const top = hasSentinel || rankable.length > topN + 1 ? rankable.slice(0, topN) : rankable;
  const rest = ordered.filter((k) => !top.includes(k));
  return build(
    trends,
    top,
    (m) => m,
    (m) => colorFor(colors, m),
    (p, m) => p.byModel.find((x) => x.key === m)?.tokens ?? 0,
    rest,
  );
}

export type SingleMetric = "tokens" | "cost" | "hours";

/** One series for a single user's trend card. */
export function stackSingle(
  trends: TrendsResult,
  metric: SingleMetric,
  color: string,
): StackedData {
  return build(
    trends,
    ["total"],
    () => (metric === "tokens" ? "Tokens" : metric === "cost" ? "Cost" : "Hours"),
    () => color,
    (p) => (metric === "tokens" ? p.total : metric === "cost" ? p.costUsd : p.activeMs / 3_600_000),
  );
}

/** Which bar labels to print under a chart: at most `maxLabels`, evenly spaced, always the ends. */
export function pickLabels(count: number, maxLabels: number): number[] {
  if (count <= 0) return [];
  if (count <= maxLabels) return Array.from({ length: count }, (_, i) => i);
  const step = (count - 1) / (maxLabels - 1);
  const out: number[] = [];
  for (let i = 0; i < maxLabels; i++) out.push(Math.round(i * step));
  return [...new Set(out)];
}

/** "Nice" y-axis ceiling so the tallest bar does not touch the top: 1, 2, 5 × 10^n above `max`. */
export function niceCeiling(max: number): number {
  if (max <= 0) return 1;
  const exp = Math.floor(Math.log10(max));
  const base = 10 ** exp;
  for (const m of [1, 2, 5, 10]) if (m * base >= max) return m * base;
  return 10 * base;
}

export type Segment = { key: string; label: string; value: number; share: number; color: string };

/** Top `n` by value plus Other, as 100 %-bar segments. */
export function shareSegments(
  items: { key: string; label?: string; value: number }[],
  colorOf: (key: string) => string,
  n = 6,
): Segment[] {
  const sorted = [...items].sort((a, b) => b.value - a.value || (a.key < b.key ? -1 : 1));
  const rankable = sorted.filter((i) => i.key !== OTHER_KEY);
  const head = sorted.length > n ? rankable.slice(0, n) : rankable;
  const tail = sorted.filter((i) => !head.includes(i)).reduce((acc, i) => acc + i.value, 0);
  const rows = [...head.map((i) => ({ key: i.key, label: i.label ?? i.key, value: i.value }))];
  if (tail > 0) rows.push({ key: OTHER_KEY, label: "Other", value: tail });
  const total = rows.reduce((acc, r) => acc + r.value, 0);
  return rows.map((r) => ({
    ...r,
    share: total > 0 ? r.value / total : 0,
    color: r.key === OTHER_KEY ? OTHER_COLOR : colorOf(r.key),
  }));
}
