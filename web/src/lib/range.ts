import { MAX_CUSTOM_RANGE_DAYS } from "@shared/constants";
import { addDays, compareDays, daysBetween, isValidDay } from "@shared/days";
import type { BoundsResult } from "@convex/lib/types";
import { formatDay, formatDayShort } from "@shared/format";
import { allTimeRange, latestDay } from "@shared/summary";

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

function resolvePreset(
  preset: Exclude<Preset, "ALL">,
  today: string,
  bounds?: BoundsResult | null,
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
  bounds?: BoundsResult | null,
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
  bounds?: BoundsResult | null,
): ResolvedRange | null {
  if (params.from !== null && params.to !== null) {
    const custom = resolveCustom(params.from, params.to, today, bounds);
    if (custom !== null) return custom;
    return { ...resolvePreset(DEFAULT_PRESET, today, bounds), invalidCustom: true };
  }
  if (params.range === "ALL") {
    if (bounds === undefined || bounds === null) return null;
    // Shared with the menu bar card's `all` tab, which has to resolve the same window on the
    // client's own calendar day — see `allTimeRange` for why both ends are clamped against
    // `today`. Do not reinline this: the two surfaces disagreeing about what "all time" means is
    // exactly the drift the shared helper exists to prevent.
    const { from, to } = allTimeRange(today, bounds);
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
