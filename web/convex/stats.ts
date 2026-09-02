import { ConvexError, v } from "convex/values";
import { bucketStart, daysBetween, eachBucket } from "../../shared/src/days";
import { addTokens, emptyTokens, percentChange, ratio, ttftMean, ttftMedianApprox } from "../../shared/src/metrics";
import type { Tokens } from "../../shared/src/sync";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { mergeRollups, type Aggregate } from "./lib/aggregate";
import { authedQuery } from "./lib/auth";
import { MAX_ROLLUP_DOCS_PER_QUERY } from "./lib/constants";
import { loadPriceMap, priceTokens, sumCost } from "./lib/cost";
import { assertRange, resolvePeriods } from "./lib/days";
import type {
  BreakdownsResult,
  LeaderboardResult,
  LeaderboardRow,
  Metric,
  MetricKey,
  ModelRow,
  Range,
  SummaryResult,
  TrendPoint,
  TrendsResult,
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

export const trends = authedQuery({
  args: {
    from: v.string(),
    to: v.string(),
    bucket: v.union(v.literal("day"), v.literal("week"), v.literal("month")),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args): Promise<TrendsResult> => {
    const range = assertRange(args.from, args.to);
    const prices = await loadPriceMap(ctx);
    const docs = await loadRollups(ctx, range, args.userId);

    const byBucket = new Map<string, Doc<"dailyRollups">[]>();
    for (const doc of docs) {
      const key = bucketStart(doc.day, args.bucket);
      const list = byBucket.get(key);
      if (list) list.push(doc);
      else byBucket.set(key, [doc]);
    }

    const userIds = new Set<Id<"users">>();
    const modelTotals = new Map<string, number>();
    const points: TrendPoint[] = eachBucket(range.from, range.to, args.bucket).map((bucket) => {
      const bucketDocs = byBucket.get(bucket) ?? [];
      const agg = mergeRollups(bucketDocs);
      const byUser = [...groupByUser(bucketDocs)]
        .map(([userId, userDocs]) => {
          userIds.add(userId);
          const u = mergeRollups(userDocs);
          return {
            key: userId as string,
            tokens: u.tokens.total,
            costUsd: sumCost(u.byModel, prices).totalUsd,
            activeMs: u.activeMs,
          };
        })
        .sort((a, b) => cmpKey(a.key, b.key));
      const models = new Map<string, number>();
      for (const m of agg.byModel) models.set(m.key, (models.get(m.key) ?? 0) + m.tokens.total);
      const byModel = [...models]
        .map(([key, tokens]) => ({ key, tokens }))
        .sort((a, b) => b.tokens - a.tokens || cmpKey(a.key, b.key));
      for (const m of byModel) modelTotals.set(m.key, (modelTotals.get(m.key) ?? 0) + m.tokens);
      return {
        bucket,
        total: agg.tokens.total,
        tokens: agg.tokens,
        costUsd: sumCost(agg.byModel, prices).totalUsd,
        activeMs: agg.activeMs,
        sessions: agg.sessions,
        byUser,
        byModel,
      };
    });

    const users: UserRef[] = [];
    for (const userId of userIds) users.push(await userRef(ctx, userId));
    users.sort((a, b) => cmpKey(a.name, b.name));
    const models = [...modelTotals]
      .sort((a, b) => b[1] - a[1] || cmpKey(a[0], b[0]))
      .map(([key]) => key);
    let peak: TrendsResult["peak"] = null;
    for (const point of points) {
      if (point.total > 0 && (peak === null || point.total > peak.total)) {
        peak = { bucket: point.bucket, total: point.total };
      }
    }
    return { bucket: args.bucket, points, users, models, peak };
  },
});

export const breakdowns = authedQuery({
  args: { from: v.string(), to: v.string(), userId: v.optional(v.id("users")) },
  handler: async (ctx, args): Promise<BreakdownsResult> => {
    const range = assertRange(args.from, args.to);
    const prices = await loadPriceMap(ctx);
    const agg = mergeRollups(await loadRollups(ctx, range, args.userId));
    const totalTokens = agg.tokens.total;
    const share = (n: number) => ratio(n, totalTokens) ?? 0;
    const tokensDesc = <T extends { key: string; tokens: number }>(a: T, b: T) =>
      b.tokens - a.tokens || cmpKey(a.key, b.key);
    const countDesc = <T extends { key: string; count: number }>(a: T, b: T) =>
      b.count - a.count || cmpKey(a.key, b.key);
    const modelRowsDesc = (a: ModelRow, b: ModelRow) =>
      b.tokens.total - a.tokens.total || cmpKey(a.key, b.key) || cmpKey(a.effort ?? "", b.effort ?? "");

    const byModelEffort: ModelRow[] = agg.byModel
      .map((m) => ({
        key: m.key,
        effort: m.effort ?? null,
        tokens: m.tokens,
        responses: m.responses,
        costUsd: priceTokens(m.key, m.tokens, prices)?.total ?? null,
        share: share(m.tokens.total),
      }))
      .sort(modelRowsDesc);

    const models = new Map<string, { tokens: Tokens; responses: number }>();
    const efforts = new Map<string, { tokens: number; responses: number }>();
    for (const m of agg.byModel) {
      const model = models.get(m.key) ?? { tokens: emptyTokens(), responses: 0 };
      model.tokens = addTokens(model.tokens, m.tokens);
      model.responses += m.responses;
      models.set(m.key, model);
      const effortKey = m.effort ?? "(none)";
      const effort = efforts.get(effortKey) ?? { tokens: 0, responses: 0 };
      effort.tokens += m.tokens.total;
      effort.responses += m.responses;
      efforts.set(effortKey, effort);
    }
    const byModel: ModelRow[] = [...models]
      .map(([key, m]) => ({
        key,
        effort: null,
        tokens: m.tokens,
        responses: m.responses,
        costUsd: priceTokens(key, m.tokens, prices)?.total ?? null,
        share: share(m.tokens.total),
      }))
      .sort(modelRowsDesc);
    const byEffort = [...efforts]
      .map(([key, e]) => ({ key, tokens: e.tokens, responses: e.responses, share: share(e.tokens) }))
      .sort(tokensDesc);

    const toolCalls = agg.byTool.reduce((sum, t) => sum + t.count, 0);
    const byTool = agg.byTool
      .map((t) => ({ key: t.key, count: t.count, share: ratio(t.count, toolCalls) ?? 0 }))
      .sort(countDesc);
    const byMcpTool = [...agg.byMcpTool].sort(countDesc);
    const bySkill = [...agg.bySkill].sort(countDesc);
    const byProject = agg.byProject.map((p) => ({ ...p, share: share(p.tokens) })).sort(tokensDesc);

    const byMachine = [];
    for (const m of agg.byMachine) {
      const machine = await ctx.db
        .query("machines")
        .withIndex("by_machineId", (q) => q.eq("machineId", m.key))
        .unique();
      byMachine.push({
        key: m.key,
        label: machine?.label ?? m.key,
        tokens: m.tokens,
        sessions: m.sessions,
        share: share(m.tokens),
      });
    }
    byMachine.sort(tokensDesc);
    const bySource = agg.bySource.map((s) => ({ ...s, share: share(s.tokens) })).sort(tokensDesc);

    return {
      totalTokens,
      byModel,
      byModelEffort,
      byEffort,
      byTool,
      byMcpTool,
      bySkill,
      byProject,
      byMachine,
      bySource,
      byHour: agg.byHour,
      toolCalls,
    };
  },
});
