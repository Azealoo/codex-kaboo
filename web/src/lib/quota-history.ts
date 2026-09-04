import type { QuotaHistoryPoint } from "@convex/lib/types";

export type SparkPoint = { x: number; y: number };

/**
 * Maps readings onto an SVG box: x by time across `[from, to]`, y by used-percent with 0 % at the
 * bottom and 100 % at the top. A single reading sits at its time; the caller decides how to draw
 * it (a dot rather than a zero-length line).
 */
export function sparklinePoints(
  points: readonly QuotaHistoryPoint[],
  from: number,
  to: number,
  width: number,
  height: number,
): SparkPoint[] {
  const span = to - from;
  if (span <= 0) return [];
  return points
    .filter((p) => p.t >= from && p.t <= to)
    .map((p) => ({
      x: ((p.t - from) / span) * width,
      y: height - (Math.min(100, Math.max(0, p.usedPercent)) / 100) * height,
    }));
}

/** `M x y L x y …` for a polyline; empty string for fewer than two points. */
export function sparklinePath(points: readonly SparkPoint[]): string {
  if (points.length < 2) return "";
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");
}

/**
 * The most recent reading versus the newest one at least `windowMs` older, in percentage points —
 * "used 12 pts more than a day ago". `null` when the history is too short to say.
 */
export function usedDelta(
  points: readonly QuotaHistoryPoint[],
  windowMs: number,
): { latest: number; earlier: number; delta: number } | null {
  if (points.length === 0) return null;
  const latest = points[points.length - 1]!;
  let earlier: QuotaHistoryPoint | null = null;
  for (const p of points) {
    if (latest.t - p.t >= windowMs) earlier = p;
    else break;
  }
  if (earlier === null) return null;
  return {
    latest: latest.usedPercent,
    earlier: earlier.usedPercent,
    delta: latest.usedPercent - earlier.usedPercent,
  };
}

/**
 * Where the weekly window reset inside the history: a reading whose used-percent drops sharply
 * from the previous one. Rendered as a hairline so the sawtooth reads as a reset, not a data error.
 */
export function resetMarkers(points: readonly QuotaHistoryPoint[], dropPts = 20): number[] {
  const marks: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const cur = points[i]!;
    if (prev.usedPercent - cur.usedPercent >= dropPts) marks.push(cur.t);
  }
  return marks;
}

/** `sinceMs` for the history subscription: `days` back from `now`, floored to the hour so the query
 *  args (and therefore the Convex subscription) change once an hour rather than every tick. */
export function historySince(nowMs: number, days: number): number {
  const hour = 3_600_000;
  return Math.floor(nowMs / hour) * hour - days * 86_400_000;
}
