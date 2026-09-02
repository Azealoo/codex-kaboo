import { dayHourIn } from "@codex-kaboo/shared/days";

const MS_THRESHOLD = 1e12; // values above this are already milliseconds

/** Line `timestamp` (ISO string, or a number in seconds/ms) → Unix ms, or null. */
export function parseLineTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value > MS_THRESHOLD ? Math.floor(value) : Math.round(value * 1000);
  }
  if (typeof value === "string" && value.length > 0) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/** Unix seconds (started_at / completed_at / resets_at) → ms; ms input is passed through. */
export function secondsToMs(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value > MS_THRESHOLD ? Math.floor(value) : Math.round(value * 1000);
}

export function isValidZone(zone: unknown): zone is string {
  if (typeof zone !== "string" || zone.length === 0) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export function machineZone(): string | undefined {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidZone(zone) ? zone : undefined;
  } catch {
    return undefined;
  }
}

/** First valid zone of (session zone, fallback); undefined lets dayHourIn use the machine zone → UTC. */
export function resolveZone(sessionZone: unknown, fallback: string | undefined): string | undefined {
  if (isValidZone(sessionZone)) return sessionZone;
  if (isValidZone(fallback)) return fallback;
  return undefined;
}

export function dayHour(tsMs: number, zone: string | undefined): { day: string; hour: number } {
  return dayHourIn(tsMs, zone);
}
