import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { QUOTA_PRUNE_PAGE_SIZE, QUOTA_SNAPSHOT_RETENTION_MS } from "./lib/constants";

/**
 * Deletes `quotaSnapshots` older than the retention window, one page at a time, rescheduling itself
 * while rows remain. Run daily by `crons.ts`; safe to run by hand with
 * `npx convex run quota:pruneSnapshots '{}'`. `now` is injectable for tests.
 */
export const pruneSnapshots = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ deleted: number; done: boolean }> => {
    const now = args.now ?? Date.now();
    const cutoff = now - QUOTA_SNAPSHOT_RETENTION_MS;
    const stale = await ctx.db
      .query("quotaSnapshots")
      .withIndex("by_receivedAt", (q) => q.lt("receivedAt", cutoff))
      .take(QUOTA_PRUNE_PAGE_SIZE + 1);
    const page = stale.slice(0, QUOTA_PRUNE_PAGE_SIZE);
    for (const row of page) await ctx.db.delete(row._id);
    const done = stale.length <= QUOTA_PRUNE_PAGE_SIZE;
    if (!done) await ctx.scheduler.runAfter(0, internal.quota.pruneSnapshots, { now });
    return { deleted: page.length, done };
  },
});
