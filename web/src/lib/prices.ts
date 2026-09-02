/** USD per million tokens: finite, non-negative, at most 6 decimal places. `null` on anything else. */
export function parsePrice(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? value : null;
}
