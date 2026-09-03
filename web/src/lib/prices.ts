import { MAX_PRICE_USD_PER_MTOK } from "@shared/constants";

/**
 * USD per million tokens: finite, non-negative, at most 6 decimal places, and no more than
 * `MAX_PRICE_USD_PER_MTOK` (a typo guard, not a policy limit — see that constant). `null` on
 * anything else.
 */
export function parsePrice(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 && value <= MAX_PRICE_USD_PER_MTOK ? value : null;
}
