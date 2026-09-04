import { CATEGORICAL } from "./theme";

export type ColorMap = ReadonlyMap<string, string>;
export const OTHER_COLOR = "#9aa3ae";

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

/** Users get slots by stable id order, so a teammate keeps their colour across every screen. */
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

/** Priced models newest-first, then unpriced seen models alphabetically — same rule as the web. */
export function modelColorMap(
  pricedModels: readonly string[],
  seenModels: readonly string[],
): Map<string, string> {
  const priced = [...new Set(pricedModels)].sort(comparePriced);
  const pricedSet = new Set(priced);
  const extras = [...new Set(seenModels)]
    .filter((m) => !pricedSet.has(m))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return assignSlots([...priced, ...extras]);
}
