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
export const OTHER_COLOR = "#9aa3ae";
export const HEAT_RAMP = ["#eceff3", "#6cc482", "#2f9f55", "#1a7a40", "#0d532b"] as const;
export const STATUS_COLORS = { good: "#0ca30c", warning: "#fab219", critical: "#d03b3b" } as const;
export const DELTA_COLORS = {
  up: { fg: "#006300", bg: "#e6f4e6" },
  down: { fg: "#b42318", bg: "#fdecec" },
} as const;

export type ColorMap = ReadonlyMap<string, string>;

/** Fixed-order slot assignment: the first 8 distinct keys get the palette, the rest are gray. */
export function assignSlots(keys: readonly string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const key of keys) {
    if (map.has(key)) continue;
    const slot = map.size;
    map.set(key, slot < CATEGORICAL.length ? CATEGORICAL[slot]! : OTHER_COLOR);
  }
  return map;
}

export function colorFor(map: ColorMap, key: string): string {
  return map.get(key) ?? OTHER_COLOR;
}

export function userColorMap(userIds: readonly string[]): Map<string, string> {
  return assignSlots([...userIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
}

function modelVersion(model: string): number | null {
  const match = /^gpt-(\d+(?:\.\d+)?)/.exec(model);
  return match ? Number(match[1]) : null;
}

function comparePriced(a: string, b: string): number {
  const va = modelVersion(a);
  const vb = modelVersion(b);
  if (va !== null && vb !== null && va !== vb) return vb - va;
  if (va !== null && vb === null) return -1;
  if (va === null && vb !== null) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Priced models newest-first (by `gpt-<version>`), then unpriced seen models alphabetically. */
export function modelRegistryOrder(
  pricedModels: readonly string[],
  seenModels: readonly string[],
): string[] {
  const priced = [...new Set(pricedModels)].sort(comparePriced);
  const pricedSet = new Set(priced);
  const extras = [...new Set(seenModels)]
    .filter((m) => !pricedSet.has(m))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return [...priced, ...extras];
}

export function modelColorMap(
  pricedModels: readonly string[],
  seenModels: readonly string[],
): Map<string, string> {
  return assignSlots(modelRegistryOrder(pricedModels, seenModels));
}

export function quotaColor(usedPercent: number): string {
  if (usedPercent < 60) return STATUS_COLORS.good;
  if (usedPercent < 85) return STATUS_COLORS.warning;
  return STATUS_COLORS.critical;
}

/**
 * Heatmap cells read the ramp through CSS variables (`--heat-0` … `--heat-4` in globals.css) so the
 * same cell is legible in both themes; `HEAT_RAMP` above stays as the documented light values.
 */
export function heatColor(level: 0 | 1 | 2 | 3 | 4): string {
  return `var(--heat-${level})`;
}
