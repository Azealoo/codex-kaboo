const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const EM_DASH = "—";
const MINUS = "−";

function group(n: number): string {
  const rounded = Math.round(Math.abs(n));
  const digits = String(rounded);
  const withCommas = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return n < 0 && rounded !== 0 ? `-${withCommas}` : withCommas;
}

export function formatInt(n: number): string {
  if (!Number.isFinite(n)) return EM_DASH;
  return group(n);
}

function trimZero(s: string): string {
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

export function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return EM_DASH;
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs < 999.5) return group(n);
  const units: Array<[number, string]> = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [size, suffix] of units) {
    if (abs >= size - size / 2000) {
      const value = abs / size;
      const text = value >= 999.95 ? trimZero((abs / size).toFixed(0)) : trimZero(value.toFixed(1));
      return `${sign}${text}${suffix}`;
    }
  }
  return group(n);
}

export function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return EM_DASH;
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs === 0) return "$0.00";
  if (abs < 0.005) return "<$0.01";
  if (abs < 99.995) return `${sign}$${abs.toFixed(2)}`;
  return `${sign}$${group(abs)}`;
}

export function formatPercent(fraction: number | null, digits = 1): string {
  if (fraction === null || !Number.isFinite(fraction)) return EM_DASH;
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function formatDeltaPercent(change: number | null): string {
  if (change === null || !Number.isFinite(change)) return EM_DASH;
  const pct = Math.abs(change * 100).toFixed(1);
  if (change > 0) return `+${pct}%`;
  if (change < 0) return `${MINUS}${pct}%`;
  return `${pct}%`;
}

export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m ${totalSeconds % 60}s`;
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) return `${totalHours}h ${totalMinutes % 60}m`;
  const days = Math.floor(totalHours / 24);
  return `${days}d ${totalHours % 24}h`;
}

export function formatHours(ms: number): string {
  if (!Number.isFinite(ms)) return EM_DASH;
  const hours = Math.max(0, ms) / 3_600_000;
  if (hours >= 100) return `${Math.round(hours)}h`;
  return `${trimZero(hours.toFixed(1))}h`;
}

export function formatRelative(fromMs: number, nowMs: number): string {
  const diff = nowMs - fromMs;
  if (diff < 45_000) return "just now";
  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(diff / 3_600_000);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(diff / 86_400_000);
  return `${days} d ago`;
}

export function formatResetsIn(resetsAtMs: number | null, nowMs: number): string {
  if (resetsAtMs === null) return "Reset time unknown";
  const diff = resetsAtMs - nowMs;
  if (diff <= 0) return "Reset passed";
  if (diff < 60_000) return "Resets in under a minute";
  const text = formatDurationMs(diff);
  const coarse = text.includes("d ") || text.includes("h ") ? text : text.replace(/\s\d+s$/, "");
  return `Resets in ${coarse}`;
}

function parts(day: string): { y: number; m: number; d: number } {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return { y, m, d };
}

export function formatDay(day: string): string {
  const { y, m, d } = parts(day);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

export function formatDayShort(day: string): string {
  const { m, d } = parts(day);
  return `${MONTHS[m - 1]} ${d}`;
}

export function formatMonth(day: string): string {
  const { y, m } = parts(day);
  return `${MONTHS[m - 1]} ${y}`;
}

export function formatDateTime(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${hh}:${mm}`;
}

export function formatNullable<T>(value: T | null | undefined, fn: (v: T) => string): string {
  return value === null || value === undefined ? EM_DASH : fn(value);
}
