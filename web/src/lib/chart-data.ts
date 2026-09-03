import { OTHER_KEY } from "@shared/constants";
import type { CostByKind, TrendsResult } from "@convex/lib/types";
import { CATEGORICAL, OTHER_COLOR, colorFor, type ColorMap } from "./colors";
import { formatDayShort, formatMonth } from "./format";

export type SeriesDef = { key: string; label: string; color: string; entity: string };
export type ChartRow = { x: string; label: string } & Record<string, number | string>;
export type Peak = { x: string; label: string; total: number } | null;
export type Stacked = { rows: ChartRow[]; series: SeriesDef[]; peak: Peak; total: number };
export type Segment = { key: string; label: string; value: number; share: number; color: string };

export function bucketLabel(bucket: string, granularity: "day" | "week" | "month"): string {
  return granularity === "month" ? formatMonth(bucket) : formatDayShort(bucket);
}

function sumByEntity(
  points: TrendsResult["points"],
  pick: (p: TrendsResult["points"][number]) => { key: string; value: number }[],
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const p of points) {
    for (const { key, value } of pick(p)) totals.set(key, (totals.get(key) ?? 0) + value);
  }
  return totals;
}

function sortedEntities(totals: Map<string, number>): string[] {
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([key]) => key);
}

function assemble(
  trends: TrendsResult,
  entities: string[],
  labelOf: (entity: string) => string,
  colorOf: (entity: string) => string,
  valueOf: (p: TrendsResult["points"][number], entity: string) => number,
  otherEntities: string[] = [],
): Stacked {
  const series: SeriesDef[] = entities.map((entity, i) => ({
    key: `s${i}`,
    label: labelOf(entity),
    color: colorOf(entity),
    entity,
  }));
  if (otherEntities.length > 0) {
    series.push({ key: "other", label: "Other", color: OTHER_COLOR, entity: OTHER_KEY });
  }
  let peak: Peak = null;
  let total = 0;
  const rows: ChartRow[] = [];
  for (const p of trends.points) {
    const row: ChartRow = { x: p.bucket, label: bucketLabel(p.bucket, trends.bucket) };
    let rowTotal = 0;
    entities.forEach((entity, i) => {
      const v = valueOf(p, entity);
      row[`s${i}`] = v;
      rowTotal += v;
    });
    if (otherEntities.length > 0) {
      const other = otherEntities.reduce((acc, e) => acc + valueOf(p, e), 0);
      row.other = other;
      rowTotal += other;
    }
    total += rowTotal;
    if (rowTotal > 0 && (peak === null || rowTotal > peak.total)) {
      peak = { x: p.bucket, label: row.label, total: rowTotal };
    }
    rows.push(row);
  }
  return { rows, series, peak, total };
}

export function trendByUser(trends: TrendsResult, colors: ColorMap): Stacked {
  const totals = sumByEntity(trends.points, (p) =>
    p.byUser.map((u) => ({ key: u.key, value: u.tokens })),
  );
  const names = new Map(trends.users.map((u) => [u.userId as string, u.name]));
  return assemble(
    trends,
    sortedEntities(totals),
    (id) => names.get(id) ?? id,
    (id) => colorFor(colors, id),
    (p, id) => p.byUser.find((u) => u.key === id)?.tokens ?? 0,
  );
}

export function trendByModel(trends: TrendsResult, colors: ColorMap, topN = 7): Stacked {
  const totals = sumByEntity(trends.points, (p) =>
    p.byModel.map((m) => ({ key: m.key, value: m.tokens })),
  );
  const ordered = sortedEntities(totals);
  const top = ordered.length > topN + 1 ? ordered.slice(0, topN) : ordered;
  const rest = ordered.slice(top.length);
  return assemble(
    trends,
    top,
    (m) => m,
    (m) => colorFor(colors, m),
    (p, m) => p.byModel.find((x) => x.key === m)?.tokens ?? 0,
    rest,
  );
}

export type TrendMetric = "tokens" | "cost" | "hours";

export function trendSingle(trends: TrendsResult, metric: TrendMetric, color: string): Stacked {
  const label = metric === "tokens" ? "Tokens" : metric === "cost" ? "Cost" : "Hours";
  return assemble(
    trends,
    ["total"],
    () => label,
    () => color,
    (p) => {
      if (metric === "tokens") return p.total;
      if (metric === "cost") return p.costUsd;
      return p.activeMs / 3_600_000;
    },
  );
}

/**
 * The trend card's "Unpriced: …" footer text for the Cost view, or `null` when nothing needs
 * qualifying. Only `cost` can be understated by an unpriced model — `tokens` and `hours` are exact
 * counts regardless of pricing. Matches the house style used by the overview cards and the cost
 * structure card (`Unpriced: <models>`), so the same range reads the same way everywhere.
 */
export function unpricedFooter(metric: TrendMetric, unpricedModels: string[]): string | null {
  if (metric !== "cost" || unpricedModels.length === 0) return null;
  return `Unpriced: ${unpricedModels.join(", ")}`;
}

/**
 * Top `n` by value, everything else summed into one `otherKey` row.
 *
 * An entry already carrying `otherKey` never occupies one of the `n` slots, however large it is.
 * Rollups cap their own keyed arrays at 100 and fold the rest, so a breakdown wide enough to have
 * been capped server-side arrives here with that row already in it — and a tail summed over a
 * hundred keys routinely outranks the 8th-largest single key. Keeping it and appending another
 * yields two rows with one key: a duplicate React key, two "Other" slices in the same chart, and a
 * legend that reads as though the tail were counted twice. Folding the two together is also what
 * keeps the row honest, since it means "everything not shown" at both levels.
 */
export function foldTopN<T extends { key: string; value: number }>(
  items: T[],
  n: number,
  otherKey = OTHER_KEY,
): { key: string; value: number }[] {
  const sorted = [...items].sort((a, b) => b.value - a.value || (a.key < b.key ? -1 : 1));
  // Nothing to fold, so an entry already keyed `otherKey` is simply one more row and stays put.
  if (sorted.length <= n) return sorted.map(({ key, value }) => ({ key, value }));
  const rankable = sorted.filter((item) => item.key !== otherKey);
  const head = rankable.slice(0, n).map(({ key, value }) => ({ key, value }));
  const tail = [...rankable.slice(n), ...sorted.filter((item) => item.key === otherKey)].reduce(
    (acc, item) => acc + item.value,
    0,
  );
  return [...head, { key: otherKey, value: tail }];
}

const COST_KINDS: { key: keyof CostByKind; label: string; color: string }[] = [
  { key: "input", label: "Input", color: CATEGORICAL[1] },
  { key: "cached", label: "Cached input", color: CATEGORICAL[0] },
  { key: "output", label: "Output", color: CATEGORICAL[2] },
  { key: "reasoning", label: "Reasoning", color: CATEGORICAL[6] },
];

export function costStructureSegments(cost: CostByKind): Segment[] {
  const total = COST_KINDS.reduce((acc, k) => acc + cost[k.key], 0);
  return COST_KINDS.map((k) => ({
    key: k.key,
    label: k.label,
    value: cost[k.key],
    share: total > 0 ? cost[k.key] / total : 0,
    color: k.color,
  }));
}

export function shareSegments(
  items: { key: string; value: number }[],
  colors: ColorMap,
  topN = 8,
): Segment[] {
  const folded = foldTopN(items, topN);
  const total = folded.reduce((acc, i) => acc + i.value, 0);
  return folded.map((i) => ({
    key: i.key,
    label: i.key === OTHER_KEY ? "Other" : i.key,
    value: i.value,
    share: total > 0 ? i.value / total : 0,
    color: i.key === OTHER_KEY ? OTHER_COLOR : colorFor(colors, i.key),
  }));
}
