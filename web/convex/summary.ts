/**
 * `GET /api/v1/summary` — the menu bar card's read endpoint.
 *
 * Authed by the same Bearer sync token as `/api/v1/sync` and scoped to that token's user: the card
 * is the menu bar of one person's machine, so it mirrors their My Page rather than the team view.
 * Quota is the one exception — the Codex limit is shared, so that row stays the account-wide gauge
 * the dashboard shows.
 *
 * Everything the card renders arrives in one request, so it can paint a whole tab bar without four
 * round trips. Server-side, though, each range is its own `runQuery`: `all` can span up to
 * MAX_QUERY_RANGE_DAYS of rollups, and folding that into the same transaction as the other three
 * would push a single query toward Convex's read ceiling for no benefit. The cost of splitting is
 * that a sync landing mid-request could leave `day` a few tokens ahead of `month`; that is
 * invisible at the card's precision and strictly better than an endpoint that fails on a long
 * history.
 */
import { v } from "convex/values";
import { QUOTA_STALE_MS } from "../../shared/src/constants";
import { isValidDay, utcMsToDay } from "../../shared/src/days";
import { percentChange } from "../../shared/src/metrics";
import {
  SUMMARY_RANGE_KEYS,
  resolveSummaryRanges,
  type QuotaEnvelope,
  type QuotaValue,
  type RangeSummary,
  type SummaryRangeKey,
  type SummaryResponse,
} from "../../shared/src/summary";
import { internal } from "./_generated/api";
import { httpAction, internalQuery } from "./_generated/server";
import { loadPriceMap } from "./lib/cost";
import { assertRange } from "./lib/days";
import { authenticate, errorResponse, internalError, jsonResponse } from "./lib/http";
import { aggregatePeriod, loadBounds, topModelOf } from "./lib/periods";
import { freshestRateLimit } from "./lib/quota";
import type { BoundsResult } from "./lib/types";

/** One tab's numbers. Built from `aggregatePeriod`, so it folds and prices exactly as My Page does. */
export const rangeData = internalQuery({
  args: {
    userId: v.id("users"),
    from: v.string(),
    to: v.string(),
    previousFrom: v.optional(v.string()),
    previousTo: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<RangeSummary> => {
    const range = assertRange(args.from, args.to);
    const previousRange =
      args.previousFrom !== undefined && args.previousTo !== undefined
        ? assertRange(args.previousFrom, args.previousTo)
        : null;
    const prices = await loadPriceMap(ctx);
    const current = await aggregatePeriod(ctx, range, prices, args.userId);
    const previous = previousRange
      ? await aggregatePeriod(ctx, previousRange, prices, args.userId)
      : null;
    return {
      range,
      previousRange,
      tokens: current.agg.tokens,
      costUsd: current.cost.totalUsd,
      unpricedModels: current.cost.unpricedModels,
      sessions: current.agg.sessions,
      // Same basis as the dashboard's delta pill: total tokens against the immediately preceding
      // equal-length period. Null when there is no previous period, and also when that period had
      // zero tokens — `percentChange` refuses to divide by it rather than reporting an infinity.
      changePercent: previous
        ? percentChange(current.agg.tokens.total, previous.agg.tokens.total)
        : null,
      topModel: topModelOf(current.agg),
    };
  },
});

/**
 * The two things the handler needs before it can resolve ranges: how far back this user's data
 * goes (for the `all` tab) and the account's newest quota reading. Both are cheap point reads, so
 * they share one transaction.
 */
export const contextData = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args): Promise<{ bounds: BoundsResult; quota: QuotaValue | null }> => {
    const bounds = await loadBounds(ctx, args.userId);
    const best = freshestRateLimit(await ctx.db.query("machines").collect());
    if (best === null) return { bounds, quota: null };
    const { machine, snapshot } = best;
    return {
      bounds,
      quota: {
        usedPercent: snapshot.usedPercent,
        windowMinutes: snapshot.windowMinutes,
        resetsAt: snapshot.resetsAt ?? null,
        planType: snapshot.planType ?? null,
        limitId: snapshot.limitId ?? null,
        observedAt: snapshot.observedAt,
        receivedAt: snapshot.receivedAt,
        machine: { machineId: machine.machineId, label: machine.label },
      },
    };
  },
});

/**
 * Wraps a reading in the envelope the card renders. `stale` is decided here, on the server clock,
 * from the server's own `receivedAt` — deciding it in the card would let a viewer's clock skew
 * flip the label on a reading that is perfectly current.
 */
export function quotaEnvelope(value: QuotaValue | null, now: number): QuotaEnvelope {
  if (value === null) return { value: null, source: "none", fetchedAt: now, stale: false };
  return {
    value,
    source: "server",
    fetchedAt: now,
    stale: now - (value.receivedAt ?? value.observedAt) > QUOTA_STALE_MS,
  };
}

export const summaryHandler = httpAction(async (ctx, request) => {
  try {
    const authed = await authenticate(ctx, request);
    if (!authed.ok) return authed.response;
    const { auth } = authed;
    const now = Date.now();

    // The client's own calendar day; the server runs in UTC and cannot know it. Defaulting to the
    // UTC day keeps `curl` against this endpoint useful, and echoing the value back in the response
    // makes a machine with a wrong clock diagnosable from the card instead of just wrong.
    const today = new URL(request.url).searchParams.get("today") ?? utcMsToDay(now);
    if (!isValidDay(today)) {
      return errorResponse(400, "invalid_request", "`today` must be a YYYY-MM-DD calendar day");
    }

    const context = await ctx.runQuery(internal.summary.contextData, { userId: auth.userId });
    const resolved = resolveSummaryRanges(today, context.bounds);
    const ranges = {} as Record<SummaryRangeKey, RangeSummary>;
    for (const key of SUMMARY_RANGE_KEYS) {
      const { range, previousRange } = resolved[key];
      ranges[key] = await ctx.runQuery(internal.summary.rangeData, {
        userId: auth.userId,
        from: range.from,
        to: range.to,
        ...(previousRange === null
          ? {}
          : { previousFrom: previousRange.from, previousTo: previousRange.to }),
      });
    }
    // Same courtesy as `whoami`, and throttled to once a minute per token by `touchToken`, so a
    // card refreshing on a timer does not turn a read into a write on every poll.
    await ctx.runMutation(internal.syncTokens.touchLastUsed, { tokenId: auth.tokenId, now });

    const body: SummaryResponse = {
      ok: true,
      serverTime: now,
      today,
      user: { userId: auth.userId, name: auth.user.name },
      ranges,
      quota: quotaEnvelope(context.quota, now),
    };
    return jsonResponse(200, body);
  } catch (error) {
    return internalError("summary", error);
  }
});
