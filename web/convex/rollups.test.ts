import { afterEach, describe, expect, it, vi } from "vitest";
import { ROLLUP_VERSION } from "../../shared/src/constants";
import { addDays } from "../../shared/src/days";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { recomputeDay, recomputeDays } from "./rollups";
import { getRollup, makeEvent, makeSession, registerUser, setup, T0, type Harness } from "./test.helpers";

async function insertData(t: Harness, userId: Id<"users">) {
  await t.run(async (ctx) => {
    await ctx.db.insert("sessions", {
      ...makeSession({ sessionId: "s1" }),
      userId,
      machineId: "machine-1",
      syncedAt: T0,
    });
    await ctx.db.insert("tokenEvents", { ...makeEvent({ sessionId: "s1", seq: 5 }), userId });
    await ctx.db.insert("tokenEvents", {
      ...makeEvent({ sessionId: "s1", seq: 9, day: "2026-09-01", hour: 0, ts: T0 + 15 * 3_600_000 }),
      userId,
    });
  });
}

async function clearData(t: Harness) {
  await t.run(async (ctx) => {
    for (const doc of await ctx.db.query("tokenEvents").collect()) await ctx.db.delete(doc._id);
    for (const doc of await ctx.db.query("sessions").collect()) await ctx.db.delete(doc._id);
  });
}

describe("recomputeDay", () => {
  it("inserts, replaces and deletes the rollup of a (user, day)", async () => {
    const t = setup();
    const userId = await registerUser(t, "alice");
    await insertData(t, userId);

    expect(await t.run(async (ctx) => recomputeDay(ctx, userId, "2026-08-31", T0))).toBe("inserted");
    const first = await getRollup(t, userId, "2026-08-31");
    expect(first).toMatchObject({ sessions: 1, responses: 1, computedAt: T0 });
    expect(first?.tokens.total).toBe(600);

    expect(await t.run(async (ctx) => recomputeDay(ctx, userId, "2026-08-31", T0 + 1))).toBe("replaced");
    const second = await getRollup(t, userId, "2026-08-31");
    expect(second?._id).toBe(first?._id);
    expect({ ...second, computedAt: 0 }).toEqual({ ...first, computedAt: 0 });

    await clearData(t);
    expect(await t.run(async (ctx) => recomputeDay(ctx, userId, "2026-08-31", T0))).toBe("deleted");
    expect(await getRollup(t, userId, "2026-08-31")).toBeNull();
    expect(await t.run(async (ctx) => recomputeDay(ctx, userId, "2026-08-31", T0))).toBe("none");
  });

  it("attributes a midnight-spanning session's events to their own days", async () => {
    const t = setup();
    const userId = await registerUser(t, "alice");
    await insertData(t, userId);
    const outcomes = await t.run(async (ctx) =>
      recomputeDays(ctx, userId, ["2026-09-01", "2026-08-31", "2026-08-31"], T0),
    );
    expect(outcomes).toEqual({ inserted: 2, replaced: 0, deleted: 0, none: 0 });

    const day1 = await getRollup(t, userId, "2026-08-31");
    expect(day1).toMatchObject({ sessions: 1, turns: 2, responses: 1 });
    expect(day1?.tokens.total).toBe(600);
    expect(day1?.byHour[9]).toBe(600);

    const day2 = await getRollup(t, userId, "2026-09-01");
    expect(day2).toMatchObject({ sessions: 0, turns: 0, responses: 1 });
    expect(day2?.tokens.total).toBe(600);
    expect(day2?.byHour[0]).toBe(600);
    expect(day2?.byProject).toEqual([
      { key: "project-a", tokens: 600, responses: 1, sessions: 0, userMessages: 0, linesAdded: 0, linesRemoved: 0 },
    ]);
    // byMachine/bySource follow byProject exactly: the post-midnight tokens land here, the
    // session count stays on the start day. The table can no longer contradict the card above it.
    expect(day2?.byMachine).toEqual([{ key: "machine-1", tokens: 600, sessions: 0 }]);
    expect(day2?.bySource).toEqual([{ key: "cli", tokens: 600, sessions: 0 }]);
    expect(day1?.byMachine).toEqual([{ key: "machine-1", tokens: 600, sessions: 1 }]);
  });
});

afterEach(() => vi.useRealTimers());

describe("rebuildAll", () => {
  it("recomputes every rollup page by page through the scheduler", async () => {
    const t = setup();
    vi.useFakeTimers();
    const userId = await registerUser(t, "alice");
    const days = Array.from({ length: 5 }, (_, i) => addDays("2026-08-01", i));
    await t.run(async (ctx) => {
      for (const [i, day] of days.entries()) {
        await ctx.db.insert("tokenEvents", { ...makeEvent({ sessionId: "s", seq: i, day }), userId });
      }
    });
    await t.run(async (ctx) => recomputeDays(ctx, userId, days, T0));
    await t.run(async (ctx) => {
      for (const rollup of await ctx.db.query("dailyRollups").collect()) {
        await ctx.db.patch(rollup._id, { version: 0, responses: 999 });
      }
    });

    const first = await t.mutation(internal.rollups.rebuildAll, { pageSize: 2 });
    expect(first).toEqual({ done: false, recomputed: 2 });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const rollups = await t.run(async (ctx) => ctx.db.query("dailyRollups").collect());
    expect(rollups).toHaveLength(5);
    expect(rollups.every((r) => r.version === ROLLUP_VERSION && r.responses === 1)).toBe(true);
    expect(await t.mutation(internal.rollups.rebuildAll, {})).toEqual({ done: true, recomputed: 5 });
  });
});
