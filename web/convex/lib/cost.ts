import { cacheSavings, costOf, type CostBreakdown, type ModelPrice } from "../../../shared/src/metrics";
import type { Tokens } from "../../../shared/src/sync";
import type { QueryCtx } from "../_generated/server";
import type { CostByKind } from "./types";

export type PriceMap = Map<string, ModelPrice>;

/** Loads every price row once per query (≤ a few dozen documents). */
export async function loadPriceMap(ctx: QueryCtx): Promise<PriceMap> {
  const rows = await ctx.db.query("modelPrices").collect();
  return new Map(
    rows.map((row) => [
      row.model,
      {
        inputUsdPerMTok: row.inputUsdPerMTok,
        cachedInputUsdPerMTok: row.cachedInputUsdPerMTok,
        outputUsdPerMTok: row.outputUsdPerMTok,
      },
    ]),
  );
}

/** Exact-model pricing; `null` means "unpriced" (contracts §9 cost rules). */
export function priceTokens(model: string, tokens: Tokens, prices: PriceMap): CostBreakdown | null {
  const price = prices.get(model);
  return price ? costOf(tokens, price) : null;
}

export type CostSummary = {
  totalUsd: number;
  byKind: CostByKind;
  cacheSavingsUsd: number;
  unpricedModels: string[];
};

/** Folds a by-model token list into cost; unpriced models contribute 0 and are listed (sorted). */
export function sumCost(byModel: { key: string; tokens: Tokens }[], prices: PriceMap): CostSummary {
  const byKind: CostByKind = { input: 0, cached: 0, output: 0, reasoning: 0 };
  let cacheSavingsUsd = 0;
  const unpriced = new Set<string>();
  for (const entry of byModel) {
    const price = prices.get(entry.key);
    if (!price) {
      if (entry.tokens.total > 0) unpriced.add(entry.key);
      continue;
    }
    const cost = costOf(entry.tokens, price);
    byKind.input += cost.input;
    byKind.cached += cost.cached;
    byKind.output += cost.output;
    byKind.reasoning += cost.reasoning;
    cacheSavingsUsd += cacheSavings(entry.tokens, price);
  }
  return {
    totalUsd: byKind.input + byKind.cached + byKind.output + byKind.reasoning,
    byKind,
    cacheSavingsUsd,
    unpricedModels: [...unpriced].sort(),
  };
}
