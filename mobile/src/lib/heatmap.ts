import { addDays, compareDays, weekStart } from "@shared/days";

export type HeatLevel = 0 | 1 | 2 | 3 | 4;
export const ACTIVITY_THRESHOLDS = [10_000_000, 100_000_000, 1_000_000_000] as const;
export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** Same fixed bins as the web heatmap (<10M, <100M, <1B, ≥1B tokens). */
export function activityLevel(tokens: number): HeatLevel {
  if (tokens <= 0) return 0;
  if (tokens < ACTIVITY_THRESHOLDS[0]) return 1;
  if (tokens < ACTIVITY_THRESHOLDS[1]) return 2;
  if (tokens < ACTIVITY_THRESHOLDS[2]) return 3;
  return 4;
}

export type HeatCell = { day: string; level: HeatLevel; tokens: number; inRange: boolean };

/** Weeks × 7 grid (Monday-first) covering [from, to]; days outside the range are blanks. */
export function activityWeeks(
  from: string,
  to: string,
  days: { day: string; tokens: number }[],
): HeatCell[][] {
  const byDay = new Map(days.map((d) => [d.day, d.tokens]));
  const weeks: HeatCell[][] = [];
  let cursor = weekStart(from);
  while (compareDays(cursor, to) <= 0) {
    const week: HeatCell[] = [];
    for (let i = 0; i < 7; i++) {
      const day = addDays(cursor, i);
      const inRange = compareDays(day, from) >= 0 && compareDays(day, to) <= 0;
      const tokens = inRange ? (byDay.get(day) ?? 0) : 0;
      week.push({ day, level: inRange ? activityLevel(tokens) : 0, tokens, inRange });
    }
    weeks.push(week);
    cursor = addDays(cursor, 7);
  }
  return weeks;
}

/** Relative level for the weekday × hour grid: quartiles of the busiest cell. */
export function relativeLevel(value: number, max: number): HeatLevel {
  if (value <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((value / max) * 4))) as HeatLevel;
}
