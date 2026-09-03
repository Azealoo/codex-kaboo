import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { computeDayRollup } from "./lib/aggregate";
import { REBUILD_PAGE_SIZE } from "./lib/constants";

export type RecomputeOutcome = "inserted" | "replaced" | "deleted" | "none";

/**
 * Recomputes one (user, day) rollup from scratch out of that day's tokenEvents and sessions.
 * Mutations see their own writes, so this runs at the end of every upsert mutation.
 */
export async function recomputeDay(
  ctx: MutationCtx,
  userId: Id<"users">,
  day: string,
  now: number,
): Promise<RecomputeOutcome> {
  const events = await ctx.db
    .query("tokenEvents")
    .withIndex("by_user_day", (q) => q.eq("userId", userId).eq("day", day))
    .collect();
  const sessions = await ctx.db
    .query("sessions")
    .withIndex("by_user_day", (q) => q.eq("userId", userId).eq("day", day))
    .collect();
  const existing = await ctx.db
    .query("dailyRollups")
    .withIndex("by_user_day", (q) => q.eq("userId", userId).eq("day", day))
    .unique();

  if (events.length === 0 && sessions.length === 0) {
    if (!existing) return "none";
    await ctx.db.delete(existing._id);
    return "deleted";
  }

  const rollup = computeDayRollup(userId, day, events, sessions, now);
  if (existing) {
    await ctx.db.replace(existing._id, rollup);
    return "replaced";
  }
  await ctx.db.insert("dailyRollups", rollup);
  return "inserted";
}

/** Recomputes each distinct day once, in ascending order. */
export async function recomputeDays(
  ctx: MutationCtx,
  userId: Id<"users">,
  days: Iterable<string>,
  now: number,
): Promise<Record<RecomputeOutcome, number>> {
  const outcomes: Record<RecomputeOutcome, number> = {
    inserted: 0,
    replaced: 0,
    deleted: 0,
    none: 0,
  };
  for (const day of [...new Set(days)].sort()) {
    outcomes[await recomputeDay(ctx, userId, day, now)] += 1;
  }
  return outcomes;
}

/**
 * Recomputes every existing rollup, REBUILD_PAGE_SIZE per invocation, rescheduling itself until
 * the index is exhausted. Idempotent; run after bumping ROLLUP_VERSION:
 *   npx convex run rollups:rebuildAll '{}'
 */
export const rebuildAll = internalMutation({
  args: { cursor: v.optional(v.string()), pageSize: v.optional(v.number()) },
  handler: async (ctx, { cursor, pageSize }): Promise<{ done: boolean; recomputed: number }> => {
    const page = await ctx.db
      .query("dailyRollups")
      .withIndex("by_user_day")
      .paginate({ cursor: cursor ?? null, numItems: pageSize ?? REBUILD_PAGE_SIZE });
    const now = Date.now();
    for (const rollup of page.page) await recomputeDay(ctx, rollup.userId, rollup.day, now);
    if (page.isDone) return { done: true, recomputed: page.page.length };
    await ctx.scheduler.runAfter(0, internal.rollups.rebuildAll, {
      cursor: page.continueCursor,
      pageSize,
    });
    return { done: false, recomputed: page.page.length };
  },
});
