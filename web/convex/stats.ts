import { v } from "convex/values";
import { percentChange, ratio, ttftMean, ttftMedianApprox } from "../../shared/src/metrics";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { mergeRollups, type Aggregate } from "./lib/aggregate";
import { authedQuery } from "./lib/auth";
import { loadPriceMap, sumCost } from "./lib/cost";
import { resolvePeriods } from "./lib/days";
import type {
  LeaderboardResult,
  LeaderboardRow,
  Metric,
  MetricKey,
  Range,
  SummaryResult,
  UserRef,
} from "./lib/types";
import { displayName } from "./users";

export const METRIC_KEYS: MetricKey[] = [
  "totalTokens", "inputTokens", "cachedInputTokens", "outputTokens", "reasoningTokens",
  "subagentTokens", "costUsd", "linesAdded", "linesRemoved", "filesChanged",
  "sessions", "turns", "responses", "messages", "userMessages", "agentMessages",
  "cacheHitRate", "tokensPerTurn", "tokensPerLine", "avgSessionActiveMs", "activeRate",
  "activeMs", "wallMs", "ttftAvgMs", "ttftP50Ms", "compactions", "activeDays",
];

// ---------- shared helpers (also used by Tasks 14–15) ----------

/** Team scope reads by_day, user scope by_user_day; both inclusive on [from, to]. */
export async function loadRollups(
  ctx: QueryCtx,
  range: Range,
  userId?: Id<"users">,
): Promise<Doc<"dailyRollups">[]> {
  if (userId !== undefined) {
    return await ctx.db
      .query("dailyRollups")
      .withIndex("by_user_day", (q) =>
        q.eq("userId", userId).gte("day", range.from).lte("day", range.to),
      )
      .collect();
  }
  return await ctx.db
    .query("dailyRollups")
    .withIndex("by_day", (q) => q.gte("day", range.from).lte("day", range.to))
    .collect();
}

/** Every card metric as a plain number; `null` marks an undefined rate (division by zero). */
export function metricValues(agg: Aggregate, costUsd: number): Record<MetricKey, number | null> {
  const t = agg.tokens;
  return {
    totalTokens: t.total,
    inputTokens: t.input,
    cachedInputTokens: t.cachedInput,
    outputTokens: t.output,
    reasoningTokens: t.reasoning,
    subagentTokens: agg.subagentTokens.total,
    costUsd,
    linesAdded: agg.linesAdded,
    linesRemoved: agg.linesRemoved,
    filesChanged: agg.filesChanged,
    sessions: agg.sessions,
    turns: agg.turns,
    responses: agg.responses,
    messages: agg.userMessages + agg.agentMessages,
    userMessages: agg.userMessages,
    agentMessages: agg.agentMessages,
    cacheHitRate: ratio(t.cachedInput, t.input),
    tokensPerTurn: ratio(t.total, agg.turns),
    tokensPerLine: ratio(t.total, agg.linesAdded),
    avgSessionActiveMs: ratio(agg.activeMs, agg.sessions),
    activeRate: ratio(agg.activeMs, agg.wallMs),
    activeMs: agg.activeMs,
    wallMs: agg.wallMs,
    ttftAvgMs: ttftMean(agg.ttft),
    ttftP50Ms: ttftMedianApprox(agg.ttft),
    compactions: agg.compactions,
    activeDays: agg.activeDays,
  };
}

export function buildMetrics(
  current: Record<MetricKey, number | null>,
  previous: Record<MetricKey, number | null> | null,
): Record<MetricKey, Metric> {
  const out = {} as Record<MetricKey, Metric>;
  for (const key of METRIC_KEYS) {
    const cur = current[key];
    const prev = previous ? previous[key] : null;
    out[key] = {
      current: cur ?? 0,
      previous: prev,
      change: cur === null || prev === null ? null : percentChange(cur, prev),
    };
  }
  return out;
}

export async function userRef(ctx: QueryCtx, userId: Id<"users">): Promise<UserRef> {
  const user = await ctx.db.get(userId);
  return {
    userId,
    name: user ? displayName(user) : "Unknown",
    imageUrl: user?.imageUrl ?? null,
  };
}

export function groupByUser(docs: Doc<"dailyRollups">[]): Map<Id<"users">, Doc<"dailyRollups">[]> {
  const groups = new Map<Id<"users">, Doc<"dailyRollups">[]>();
  for (const doc of docs) {
    const list = groups.get(doc.userId);
    if (list) list.push(doc);
    else groups.set(doc.userId, [doc]);
  }
  return groups;
}

export function cmpKey(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function byTotalThenName(a: { total: number; name: string }, b: { total: number; name: string }): number {
  return b.total - a.total || cmpKey(a.name, b.name);
}

// ---------- queries ----------

export const summary = authedQuery({
  args: {
    from: v.string(),
    to: v.string(),
    userId: v.optional(v.id("users")),
    previous: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<SummaryResult> => {
    const { range, previousRange } = resolvePeriods(args.from, args.to, args.previous);
    const prices = await loadPriceMap(ctx);
    const current = mergeRollups(await loadRollups(ctx, range, args.userId));
    const previous = previousRange
      ? mergeRollups(await loadRollups(ctx, previousRange, args.userId))
      : null;
    const currentCost = sumCost(current.byModel, prices);
    const previousValues = previous
      ? metricValues(previous, sumCost(previous.byModel, prices).totalUsd)
      : null;
    return {
      range,
      previousRange,
      tokens: current.tokens,
      previousTokens: previous ? previous.tokens : null,
      metrics: buildMetrics(metricValues(current, currentCost.totalUsd), previousValues),
      costByKind: currentCost.byKind,
      cacheSavingsUsd: currentCost.cacheSavingsUsd,
      unpricedModels: currentCost.unpricedModels,
    };
  },
});

export const leaderboard = authedQuery({
  args: { from: v.string(), to: v.string(), previous: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<LeaderboardResult> => {
    const { range, previousRange } = resolvePeriods(args.from, args.to, args.previous);
    const prices = await loadPriceMap(ctx);
    const current = groupByUser(await loadRollups(ctx, range));
    const previous = previousRange ? groupByUser(await loadRollups(ctx, previousRange)) : null;

    const refs = new Map<Id<"users">, UserRef>();
    for (const userId of [...current.keys(), ...(previous ? previous.keys() : [])]) {
      if (!refs.has(userId)) refs.set(userId, await userRef(ctx, userId));
    }
    const refFor = (userId: Id<"users">): UserRef =>
      refs.get(userId) ?? { userId, name: "Unknown", imageUrl: null };

    const previousRanks = new Map<Id<"users">, { rank: number; total: number }>();
    if (previous) {
      const prevRows = [...previous].map(([userId, docs]) => ({
        userId,
        name: refFor(userId).name,
        total: mergeRollups(docs).tokens.total,
      }));
      prevRows.sort(byTotalThenName);
      prevRows.forEach((row, index) => previousRanks.set(row.userId, { rank: index + 1, total: row.total }));
    }

    const rows: LeaderboardRow[] = [...current].map(([userId, docs]) => {
      const agg = mergeRollups(docs);
      const cost = sumCost(agg.byModel, prices);
      const prev = previousRanks.get(userId) ?? null;
      return {
        ...refFor(userId),
        tokens: agg.tokens,
        costUsd: cost.totalUsd,
        unpriced: cost.unpricedModels.length > 0,
        sessions: agg.sessions,
        turns: agg.turns,
        messages: agg.userMessages + agg.agentMessages,
        userMessages: agg.userMessages,
        linesAdded: agg.linesAdded,
        linesRemoved: agg.linesRemoved,
        tokensPerLine: ratio(agg.tokens.total, agg.linesAdded),
        cacheHitRate: ratio(agg.tokens.cachedInput, agg.tokens.input),
        activeMs: agg.activeMs,
        rank: 0,
        previousRank: prev ? prev.rank : null,
        previousTokens: prev ? prev.total : null,
        change: prev ? percentChange(agg.tokens.total, prev.total) : null,
      };
    });
    rows.sort((a, b) => b.tokens.total - a.tokens.total || cmpKey(a.name, b.name));
    rows.forEach((row, index) => {
      row.rank = index + 1;
    });
    return { range, previousRange, rows };
  },
});
