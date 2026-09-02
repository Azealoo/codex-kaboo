import { ratio } from "@shared/metrics";

export function costPerLine(costUsd: number, linesAdded: number): number | null {
  return ratio(costUsd, linesAdded);
}

export function costWithoutCaching(costUsd: number, cacheSavingsUsd: number): number {
  return costUsd + cacheSavingsUsd;
}
