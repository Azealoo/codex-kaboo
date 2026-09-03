/**
 * `~/.codex-kaboo/menubar.json` — the card's own preferences.
 *
 * Separate from `config.json` on purpose: that file is the collector's credentials, written by
 * `codex-kaboo login` and read by a scheduled sync, and a menu bar app rewriting it to remember a
 * window height is a good way to lose a token to a partial write.
 *
 * `normalizeSettings` is pure and total — it takes anything at all and returns valid settings — so
 * a hand-edited or half-written file degrades to defaults instead of stopping the app from
 * starting.
 */
import { promises as fs } from "node:fs";
import { SUMMARY_RANGE_KEYS, type SummaryRangeKey } from "@codex-kaboo/shared/summary";
import { writeJsonAtomic } from "@cli/core/config";
import type { KabooPaths } from "@cli/core/paths";
import { CARD_DEFAULT_HEIGHT } from "./anchor";

export const SETTINGS_VERSION = 1 as const;

export interface CardSettings {
  version: typeof SETTINGS_VERSION;
  /** The tab the card opens on — whichever one was last selected. */
  range: SummaryRangeKey;
  height: number;
  /** How often the server summary is refetched while the card is open. */
  refreshMs: number;
  /** Width of the live tokens-per-second strip. */
  windowMinutes: number;
  launchAtLogin: boolean;
  /** macOS only: draw the day's token count next to the tray icon. */
  showTrayLabel: boolean;
}

export const DEFAULT_SETTINGS: CardSettings = {
  version: SETTINGS_VERSION,
  range: "day",
  height: CARD_DEFAULT_HEIGHT,
  refreshMs: 5 * 60 * 1000,
  windowMinutes: 3,
  launchAtLogin: false,
  showTrayLabel: false,
};

/** Refresh no more than twice a minute and no less than hourly. */
export const MIN_REFRESH_MS = 30_000;
export const MAX_REFRESH_MS = 60 * 60 * 1000;
export const MIN_WINDOW_MINUTES = 1;
export const MAX_WINDOW_MINUTES = 30;
/** Matches TPS_RETAIN_MS: the sampler keeps 30 minutes, so no window may ask for more. */

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function numberOr(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(clamp(value, min, max))
    : fallback;
}

/**
 * Anything → valid settings. Unknown keys are dropped rather than carried, so a field removed in a
 * later version cannot come back to life through a file written by an older one; every value is
 * clamped, so a hand-edited height of 5 opens a usable card rather than a sliver.
 *
 * Height is NOT clamped to the display here — that depends on which screen the card opens on and
 * belongs to `clampCardHeight` at open time. This only rejects the absurd.
 */
export function normalizeSettings(raw: unknown): CardSettings {
  if (typeof raw !== "object" || raw === null) return { ...DEFAULT_SETTINGS };
  const record = raw as Record<string, unknown>;
  const range = SUMMARY_RANGE_KEYS.includes(record.range as SummaryRangeKey)
    ? (record.range as SummaryRangeKey)
    : DEFAULT_SETTINGS.range;
  return {
    version: SETTINGS_VERSION,
    range,
    height: numberOr(record.height, DEFAULT_SETTINGS.height, 200, 4000),
    refreshMs: numberOr(
      record.refreshMs,
      DEFAULT_SETTINGS.refreshMs,
      MIN_REFRESH_MS,
      MAX_REFRESH_MS,
    ),
    windowMinutes: numberOr(
      record.windowMinutes,
      DEFAULT_SETTINGS.windowMinutes,
      MIN_WINDOW_MINUTES,
      MAX_WINDOW_MINUTES,
    ),
    launchAtLogin: boolOr(record.launchAtLogin, DEFAULT_SETTINGS.launchAtLogin),
    showTrayLabel: boolOr(record.showTrayLabel, DEFAULT_SETTINGS.showTrayLabel),
  };
}

export async function readSettings(paths: KabooPaths): Promise<CardSettings> {
  try {
    return normalizeSettings(JSON.parse(await fs.readFile(paths.cardSettings, "utf8")));
  } catch {
    // Missing, unreadable or not JSON — all three mean "no preferences yet".
    return { ...DEFAULT_SETTINGS };
  }
}

export async function writeSettings(paths: KabooPaths, settings: CardSettings): Promise<void> {
  await writeJsonAtomic(paths.cardSettings, normalizeSettings(settings), 0o600);
}
