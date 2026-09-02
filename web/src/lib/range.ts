import { MAX_CUSTOM_RANGE_DAYS, MAX_QUERY_RANGE_DAYS } from "@shared/constants";
import { addDays, compareDays, daysBetween, isValidDay } from "@shared/days";
import type { BoundsResult } from "@convex/lib/types";
import { formatDay, formatDayShort } from "./format";

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
};

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

function resolvePreset(preset: Exclude<Preset, "ALL">, today: string): ResolvedRange {
  const days = PRESET_DAYS[preset];
  return {
    kind: preset,
    from: addDays(today, -(days - 1)),
    to: today,
    days,
    previous: true,
    label: presetLabel(preset),
  };
}

function resolveCustom(from: string, to: string, today: string): ResolvedRange | null {
  if (!isValidDay(from) || !isValidDay(to)) return null;
  const clampedTo = compareDays(to, today) > 0 ? today : to;
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
  bounds?: BoundsResult | null,
): ResolvedRange | null {
  if (params.from !== null && params.to !== null) {
    return resolveCustom(params.from, params.to, today) ?? resolvePreset(DEFAULT_PRESET, today);
  }
  if (params.range === "ALL") {
    if (bounds === undefined || bounds === null) return null;
    const earliest = addDays(today, -(MAX_QUERY_RANGE_DAYS - 1));
    // `bounds` are machine-local days; `today` is the viewer's browser day. A teammate whose
    // machine clock runs ahead of the viewer's (UTC+13/+14 vs. e.g. a US zone) can legitimately
    // own the only rollup dated `today + 1` from this viewer, which would otherwise leave `from`
    // after `to` and make every query on the page throw `bad_range` (assertRange is correct to
    // throw on that — the bug is that this function ever produced it). Clamp both ends against
    // `today` so ALL can never invert: `from` never starts after `today`, and `to` extends to
    // cover a day that is genuinely ahead of the viewer instead of silently dropping it. Do not
    // simplify this back to `to: today` — that reintroduces the silent exclusion.
    const firstDay = bounds.firstDay ?? today;
    const cappedFirst = compareDays(firstDay, today) > 0 ? today : firstDay;
    const from = compareDays(cappedFirst, earliest) < 0 ? earliest : cappedFirst;
    const lastDay = bounds.lastDay ?? today;
    const to = compareDays(lastDay, today) > 0 ? lastDay : today;
    return {
      kind: "ALL",
      from,
      to,
      days: daysBetween(from, to),
      previous: false,
      label: presetLabel("ALL"),
    };
  }
  return resolvePreset(params.range, today);
}
