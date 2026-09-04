import { MAX_CUSTOM_RANGE_DAYS, MAX_QUERY_RANGE_DAYS } from "./constants";
import { addDays, compareDays, daysBetween, isValidDay } from "./days";
import { formatDay, formatDayShort } from "./format";

/** First/last day with data, as `stats.bounds` returns them (machine-local days). */
export type RangeBounds = { firstDay: string | null; lastDay: string | null };

export const PRESETS = ["1D", "7D", "30D", "90D", "ALL"] as const;
export type Preset = (typeof PRESETS)[number];
export const DEFAULT_PRESET = "30D";

const PRESET_DAYS: Record<Exclude<Preset, "ALL">, number> = {
  "1D": 1,
  "7D": 7,
  "30D": 30,
  "90D": 90,
};

export type RangeParams = { range: Preset; from: string | null; to: string | null };

export type ResolvedRange = {
  kind: Preset | "custom";
  from: string;
  to: string;
  days: number;
  /** Whether the previous period exists (delta pills shown, server folds `previousPeriod`). */
  previous: boolean;
  label: string;
  /**
   * Set only when a `?from`/`?to` pair was rejected and the default preset was substituted.
   * Absent otherwise, so a valid range keeps its exact shape. The UI reads it to explain why the
   * range on screen is not the one in the URL — falling back silently leaves the user looking at
   * someone else's answer to their question.
   */
  invalidCustom?: true;
};

/**
 * How far past the viewer's own day a machine-local day may legitimately sit.
 *
 * Day buckets are stamped in the reporting machine's zone; range bounds are computed in the
 * viewer's browser zone. UTC-12..UTC+14 is a 26-hour spread, so a teammate can honestly be up to
 * two calendar days ahead of the viewer. Anything beyond that is a wrong clock, not a timezone,
 * and must not drag the whole dashboard forward — hence a cap rather than trusting `lastDay`.
 */
const MAX_FUTURE_DAY_LEAD = 2;

export function presetLabel(preset: Preset): string {
  switch (preset) {
    case "1D":
      return "Today";
    case "ALL":
      return "All time";
    default:
      return `Last ${PRESET_DAYS[preset]} days`;
  }
}

export function isCustom(params: RangeParams): boolean {
  return params.from !== null && params.to !== null;
}

function customLabel(from: string, to: string): string {
  return `${formatDayShort(from)} – ${formatDay(to)}`;
}

/**
 * The latest day a preset window should end on: the viewer's `today`, extended to cover a machine
 * whose day is genuinely ahead (see `MAX_FUTURE_DAY_LEAD`). `bounds` is advisory — presets resolve
 * immediately without it rather than blocking on the query the way ALL must, so `undefined` simply
 * means "no lead known yet" and the window ends at `today`.
 */
function latestDay(today: string, bounds?: RangeBounds | null): string {
  const lastDay = bounds?.lastDay;
  if (lastDay === undefined || lastDay === null) return today;
  if (compareDays(lastDay, today) <= 0) return today;
  const cap = addDays(today, MAX_FUTURE_DAY_LEAD);
  return compareDays(lastDay, cap) > 0 ? cap : lastDay;
}

function resolvePreset(
  preset: Exclude<Preset, "ALL">,
  today: string,
  bounds?: RangeBounds | null,
): ResolvedRange {
  const days = PRESET_DAYS[preset];
  // Anchored on `to`, not on `today`: keeping `from` fixed while extending `to` would make a
  // "Last 30 days" window 31 days long and desync the adjacent previous period the server folds.
  const to = latestDay(today, bounds);
  return {
    kind: preset,
    from: addDays(to, -(days - 1)),
    to,
    days,
    previous: true,
    label: presetLabel(preset),
  };
}

function resolveCustom(
  from: string,
  to: string,
  today: string,
  bounds?: RangeBounds | null,
): ResolvedRange | null {
  if (!isValidDay(from) || !isValidDay(to)) return null;
  // Same ceiling as the presets: clamping a custom range flat to `today` would drop a teammate's
  // legitimately-ahead day from a window the user asked for explicitly.
  const latest = latestDay(today, bounds);
  const clampedTo = compareDays(to, latest) > 0 ? latest : to;
  if (compareDays(from, clampedTo) > 0) return null;
  const days = daysBetween(from, clampedTo);
  if (days > MAX_CUSTOM_RANGE_DAYS) return null;
  return {
    kind: "custom",
    from,
    to: clampedTo,
    days,
    previous: true,
    label: customLabel(from, clampedTo),
  };
}

/**
 * Pure range resolution. Returns `null` only for the ALL preset while `bounds` is unknown.
 * Invalid custom ranges fall back to the default preset.
 */
export function resolveRange(
  params: RangeParams,
  today: string,
  bounds?: RangeBounds | null,
): ResolvedRange | null {
  if (params.from !== null && params.to !== null) {
    const custom = resolveCustom(params.from, params.to, today, bounds);
    if (custom !== null) return custom;
    return { ...resolvePreset(DEFAULT_PRESET, today, bounds), invalidCustom: true };
  }
  if (params.range === "ALL") {
    if (bounds === undefined || bounds === null) return null;
    // `bounds` are machine-local days; `today` is the viewer's browser day. A teammate whose
    // machine clock runs ahead of the viewer's (UTC+13/+14 vs. e.g. a US zone), or any machine
    // with a fast RTC, can legitimately own the only rollup dated `today + 1` from this viewer,
    // which would otherwise leave `from` after `to` and make every query on the page throw
    // `bad_range` (assertRange is correct to throw on that — the bug is that this function ever
    // produced it). Clamp both ends against `today` so ALL can never invert: `from` never starts
    // after `today`, and `to` extends to cover a day that is genuinely ahead of the viewer instead
    // of silently dropping it. Do not simplify this back to `to: today` — that reintroduces the
    // silent exclusion.
    const lastDay = bounds.lastDay ?? today;
    const to = compareDays(lastDay, today) > 0 ? lastDay : today;
    // The window is floored against `to`, NOT against `today`: `to` can sit ahead of `today` by
    // the line above, and a floor measured from `today` would then span MAX_QUERY_RANGE_DAYS + 1
    // days and throw the same `bad_range` this clamp exists to prevent — the same failure through
    // a different door.
    const earliest = addDays(to, -(MAX_QUERY_RANGE_DAYS - 1));
    const firstDay = bounds.firstDay ?? today;
    const cappedFirst = compareDays(firstDay, today) > 0 ? today : firstDay;
    const from = compareDays(cappedFirst, earliest) < 0 ? earliest : cappedFirst;
    return {
      kind: "ALL",
      from,
      to,
      days: daysBetween(from, to),
      previous: false,
      label: presetLabel("ALL"),
    };
  }
  return resolvePreset(params.range, today, bounds);
}
