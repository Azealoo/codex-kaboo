import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { computeDayRollup } from "./lib/aggregate";

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
  const outcomes: Record<RecomputeOutcome, number> = { inserted: 0, replaced: 0, deleted: 0, none: 0 };
  for (const day of [...new Set(days)].sort()) {
    outcomes[await recomputeDay(ctx, userId, day, now)] += 1;
  }
  return outcomes;
}
