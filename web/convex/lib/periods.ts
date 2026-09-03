/**
 * Reading `dailyRollups` over a day range: the one place a period's documents are fetched, folded
 * and priced.
 *
 * Lifted out of `stats.ts` when `/api/v1/summary` (the menu bar card) became a second reader.
 * `loadRollups` carries the document-cap guard and `aggregatePeriod` the fold-then-price order, and
 * both surfaces have to agree on them exactly — a card whose totals are assembled a slightly
 * different way from the dashboard's is worse than no card.
 */
import { ConvexError } from "convex/values";
import { daysBetween } from "../../../shared/src/days";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { OTHER_KEY } from "../../../shared/src/constants";
import { mergeRollups, type Aggregate } from "./aggregate";
import { MAX_ROLLUP_DOCS_PER_QUERY } from "./constants";
import { sumCost, type CostSummary, type PriceMap } from "./cost";
import type { BoundsResult, Range } from "./types";

/**
 * Team scope reads by_day, user scope by_user_day; both inclusive on [from, to]. `dailyRollups`
 * holds one document per (user, day), so a team-scope read is bounded only by active users × days
 * in range — unbounded by this function alone. `.take(maxDocs + 1)` peeks one row past the cap
 * (production default `MAX_ROLLUP_DOCS_PER_QUERY`; see its comment for the exact arithmetic) and
 * throws `range_too_large` instead of silently reading toward Convex's ~32,000-document read
 * ceiling, or the 16 MiB payload ceiling, which can bind sooner since each rollup carries several
 * 100-entry sub-arrays.
 */
export async function loadRollups(
  ctx: QueryCtx,
  range: Range,
  userId?: Id<"users">,
  maxDocs: number = MAX_ROLLUP_DOCS_PER_QUERY,
): Promise<Doc<"dailyRollups">[]> {
  const rows =
    userId !== undefined
      ? await ctx.db
          .query("dailyRollups")
          .withIndex("by_user_day", (q) =>
            q.eq("userId", userId).gte("day", range.from).lte("day", range.to),
          )
          .take(maxDocs + 1)
      : await ctx.db
          .query("dailyRollups")
          .withIndex("by_day", (q) => q.gte("day", range.from).lte("day", range.to))
          .take(maxDocs + 1);
  if (rows.length > maxDocs) {
    throw new ConvexError({
      code: "range_too_large",
      days: daysBetween(range.from, range.to),
      docs: maxDocs,
    });
  }
  return rows;
}

/** One range's rollups, folded and priced. `docs` is kept for callers that inspect the raw rows. */
export type Period = { docs: Doc<"dailyRollups">[]; agg: Aggregate; cost: CostSummary };

export async function aggregatePeriod(
  ctx: QueryCtx,
  range: Range,
  prices: PriceMap,
  userId?: Id<"users">,
): Promise<Period> {
  const docs = await loadRollups(ctx, range, userId);
  const agg = mergeRollups(docs);
  return { docs, agg, cost: sumCost(agg.byModel, prices) };
}

/** Oldest and newest day carrying a rollup; both null when the scope has no data at all. */
export async function loadBounds(ctx: QueryCtx, userId?: Id<"users">): Promise<BoundsResult> {
  const ordered = (direction: "asc" | "desc") =>
    userId !== undefined
      ? ctx.db
          .query("dailyRollups")
          .withIndex("by_user_day", (q) => q.eq("userId", userId))
          .order(direction)
          .first()
      : ctx.db.query("dailyRollups").withIndex("by_day").order(direction).first();
  const first = await ordered("asc");
  const last = await ordered("desc");
  return { firstDay: first?.day ?? null, lastDay: last?.day ?? null };
}

/**
 * The model with the most tokens in a period, or null when the period has none.
 *
 * `(other)` is excluded for the same reason `sumCost` excludes it from `unpricedModels`: it is the
 * 100-entry keyed-array fold, not a model, and a card labelling its busiest model "(other)" would
 * be reporting the storage cap rather than anything about the user's work.
 */
export function topModelOf(agg: Aggregate): string | null {
  const totals = new Map<string, number>();
  for (const entry of agg.byModel) {
    if (entry.key === OTHER_KEY) continue;
    totals.set(entry.key, (totals.get(entry.key) ?? 0) + entry.tokens.total);
  }
  let best: { key: string; tokens: number } | null = null;
  for (const [key, tokens] of totals) {
    if (tokens <= 0) continue;
    if (best === null || tokens > best.tokens || (tokens === best.tokens && key < best.key)) {
      best = { key, tokens };
    }
  }
  return best?.key ?? null;
}
