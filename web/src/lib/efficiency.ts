import { ratio } from "@shared/metrics";

export function costPerLine(costUsd: number, linesAdded: number): number | null {
  return ratio(costUsd, linesAdded);
}

export function costWithoutCaching(costUsd: number, cacheSavingsUsd: number): number {
  return costUsd + cacheSavingsUsd;
}

/**
 * Appends the unpriced-models qualifier to a dollar card's footer. An unpriced model's tokens
 * count toward every total but cost $0, so any dollar figure over a range containing one is
 * understated — and `codex-auto-review` is unpriced by design, which makes that most ranges. Every
 * other dollar surface says so; these two are derived figures that were missed.
 */
export function withUnpriced(
  footer: string | undefined,
  unpricedModels: string[],
): string | undefined {
  if (unpricedModels.length === 0) return footer;
  const note = `Unpriced: ${unpricedModels.join(", ")}`;
  return footer === undefined ? note : `${footer} · ${note}`;
}
