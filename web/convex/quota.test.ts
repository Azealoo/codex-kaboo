import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import { QUOTA_PRUNE_PAGE_SIZE, QUOTA_SNAPSHOT_RETENTION_MS } from "./lib/constants";
import { registerUser, setup, T0 } from "./test.helpers";

describe("quota.pruneSnapshots", () => {
  it("deletes rows past the retention window in pages and keeps the rest", async () => {
    const t = setup();
    const alice = await registerUser(t, "alice");
    const old = T0 - QUOTA_SNAPSHOT_RETENTION_MS - 1;
    await t.run(async (ctx) => {
      for (let i = 0; i < QUOTA_PRUNE_PAGE_SIZE + 3; i++) {
        await ctx.db.insert("quotaSnapshots", {
          machineId: "machine-1",
          userId: alice,
          observedAt: old - i,
          receivedAt: old - i,
          usedPercent: 1,
          windowMinutes: 10080,
        });
      }
      await ctx.db.insert("quotaSnapshots", {
        machineId: "machine-1",
        userId: alice,
        observedAt: T0 - 1000,
        receivedAt: T0 - 1000,
        usedPercent: 50,
        windowMinutes: 10080,
      });
    });
    const first = await t.mutation(internal.quota.pruneSnapshots, { now: T0 });
    expect(first).toEqual({ deleted: QUOTA_PRUNE_PAGE_SIZE, done: false });
    // The follow-up page was scheduled; run it.
    await t.finishAllScheduledFunctions(() => {});
    const remaining = await t.run(async (ctx) => ctx.db.query("quotaSnapshots").collect());
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.usedPercent).toBe(50);
  });
});
