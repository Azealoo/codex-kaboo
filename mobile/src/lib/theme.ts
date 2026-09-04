/**
 * The dashboard's palette (web/src/app/globals.css), as plain values for React Native. Keep the two
 * in step: a colour that changes on the web should change here in the same commit.
 */
export type Scheme = "light" | "dark";

export type Palette = {
  background: string;
  card: string;
  border: string;
  foreground: string;
  muted: string; // subdued surface
  mutedForeground: string;
  primary: string;
  primaryForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  statusGood: string;
  statusWarning: string;
  statusCritical: string;
  deltaUpFg: string;
  deltaUpBg: string;
  deltaDownFg: string;
  deltaDownBg: string;
  deltaFlatFg: string;
  deltaFlatBg: string;
  heat: readonly [string, string, string, string, string];
  gridLine: string;
  otherSeries: string;
};

export const LIGHT: Palette = {
  background: "#f8f9fb",
  card: "#ffffff",
  border: "#e5e7eb",
  foreground: "#111827",
  muted: "#f1f3f6",
  mutedForeground: "#6b7280",
  primary: "#008300",
  primaryForeground: "#ffffff",
  accent: "#eef7ee",
  accentForeground: "#006300",
  destructive: "#d03b3b",
  statusGood: "#0ca30c",
  statusWarning: "#fab219",
  statusCritical: "#d03b3b",
  deltaUpFg: "#006300",
  deltaUpBg: "#e6f4e6",
  deltaDownFg: "#b42318",
  deltaDownBg: "#fdecec",
  deltaFlatFg: "#4b5563",
  deltaFlatBg: "#f3f4f6",
  heat: ["#eceff3", "#6cc482", "#2f9f55", "#1a7a40", "#0d532b"],
  gridLine: "#eceff3",
  otherSeries: "#9aa3ae",
};

export const DARK: Palette = {
  background: "#0f1115",
  card: "#161a21",
  border: "#262c36",
  foreground: "#e5e7eb",
  muted: "#1f242d",
  mutedForeground: "#9aa3ae",
  primary: "#4fbf4f",
  primaryForeground: "#0f1115",
  accent: "#16301a",
  accentForeground: "#8fe08f",
  destructive: "#ef6b6b",
  statusGood: "#4fbf4f",
  statusWarning: "#f0c454",
  statusCritical: "#ef6b6b",
  deltaUpFg: "#8fe08f",
  deltaUpBg: "#16301a",
  deltaDownFg: "#f4a3a3",
  deltaDownBg: "#3a1b1b",
  deltaFlatFg: "#9aa3ae",
  deltaFlatBg: "#1f242d",
  heat: ["#1f242d", "#2f6b3d", "#3d8f52", "#57b56e", "#8fe08f"],
  gridLine: "#262c36",
  otherSeries: "#6b7280",
};

export function paletteFor(scheme: Scheme): Palette {
  return scheme === "dark" ? DARK : LIGHT;
}

/** Same fixed categorical order as `web/src/lib/colors.ts`; never cycled. */
export const CATEGORICAL = [
  "#008300",
  "#2a78d6",
  "#eb6834",
  "#1baf7a",
  "#eda100",
  "#e87ba4",
  "#4a3aa7",
  "#e34948",
] as const;

export function quotaColor(p: Palette, usedPercent: number): string {
  if (usedPercent < 60) return p.statusGood;
  if (usedPercent < 85) return p.statusWarning;
  return p.statusCritical;
}

export const RADIUS = 12;
export const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
