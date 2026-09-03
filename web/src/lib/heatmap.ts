import { addDays, compareDays, weekStart } from "@shared/days";
import type { ActivityHeatmapResult } from "@convex/lib/types";
import { formatCompact, formatDay, formatUsd } from "@shared/format";

export type HeatLevel = 0 | 1 | 2 | 3 | 4;
export type ActivityDay = ActivityHeatmapResult["days"][number];
export type ActivityCell = {
  day: string;
  level: HeatLevel;
  tokens: number;
  sessions: number;
  costUsd: number;
  inRange: boolean;
};
export type ActivityGrid = {
  weeks: ActivityCell[][];
  monthLabels: { column: number; label: string }[];
  from: string;
  to: string;
};

export const ACTIVITY_THRESHOLDS = [10_000_000, 100_000_000, 1_000_000_000] as const;
export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function activityLevel(tokens: number): HeatLevel {
  if (tokens <= 0) return 0;
  if (tokens < ACTIVITY_THRESHOLDS[0]) return 1;
  if (tokens < ACTIVITY_THRESHOLDS[1]) return 2;
  if (tokens < ACTIVITY_THRESHOLDS[2]) return 3;
  return 4;
}

export function buildActivityGrid(from: string, to: string, days: ActivityDay[]): ActivityGrid {
  const byDay = new Map(days.map((d) => [d.day, d]));
  const weeks: ActivityCell[][] = [];
  const monthLabels: { column: number; label: string }[] = [];
  let cursor = weekStart(from);
  let column = 0;
  while (compareDays(cursor, to) <= 0) {
    const week: ActivityCell[] = [];
    let labelled = false;
    for (let i = 0; i < 7; i++) {
      const day = addDays(cursor, i);
      const inRange = compareDays(day, from) >= 0 && compareDays(day, to) <= 0;
      const data = inRange ? byDay.get(day) : undefined;
      const tokens = data?.tokens ?? 0;
      week.push({
        day,
        level: inRange ? activityLevel(tokens) : 0,
        tokens,
        sessions: data?.sessions ?? 0,
        costUsd: data?.costUsd ?? 0,
        inRange,
      });
      if (!labelled && inRange && (column === 0 || day.endsWith("-01"))) {
        monthLabels.push({ column, label: MONTHS[Number(day.slice(5, 7)) - 1]! });
        labelled = true;
      }
    }
    weeks.push(week);
    cursor = addDays(cursor, 7);
    column += 1;
  }
  return { weeks, monthLabels, from, to };
}

export function heatLevel(value: number, max: number): HeatLevel {
  if (value <= 0 || max <= 0) return 0;
  const level = Math.ceil((value / max) * 4);
  return Math.min(4, Math.max(1, level)) as HeatLevel;
}

export function hourLabel(hour: number): string {
  return String(hour).padStart(2, "0");
}

/**
 * The heatmap's cell tooltip/`aria-label` text — one function so the two always agree. `unpriced`
 * is the range's `unpricedModels.length > 0`, not a per-cell fact: a day's `costUsd` sums across
 * every model active that day, so a day with an unpriced model still shows a real (understated)
 * dollar figure, never a $0 that would look complete. Flag it rather than print it silently.
 */
export function describeCell(c: ActivityCell, unpriced: boolean): string {
  const cost = unpriced ? `${formatUsd(c.costUsd)} (unpriced)` : formatUsd(c.costUsd);
  return `${formatDay(c.day)}: ${formatCompact(c.tokens)} tokens, ${c.sessions} sessions, ${cost}`;
}
