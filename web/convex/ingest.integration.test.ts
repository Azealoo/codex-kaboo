import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getRollup,
  makeBatch,
  makeEvent,
  makeMachine,
  makeSession,
  postSync,
  setup,
  T0,
  userWithToken,
} from "./test.helpers";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(T0 + 7_200_000));
});
afterEach(() => vi.useRealTimers());

function baseBatch() {
  return makeBatch({
    sessions: [makeSession({ sessionId: "s1" }), makeSession({ sessionId: "s2", project: "project-b" })],
    tokenEvents: [
      makeEvent({ sessionId: "s1", seq: 3 }),
      makeEvent({ sessionId: "s1", seq: 7, hour: 10 }),
      makeEvent({ sessionId: "s2", seq: 2, project: "project-b" }),
    ],
  });
}

describe("heartbeat", () => {
  it("accepts an empty batch: machine upserted, lastSyncAt updated, zero counts, no rollups", async () => {
    const t = setup();
    const { raw } = await userWithToken(t, "alice");
    const res = await postSync(t, raw, makeBatch({ sessions: [], tokenEvents: [] }));
    expect(res.status).toBe(200);
    expect(res.json.accepted).toEqual({
      sessions: { inserted: 0, updated: 0, unchanged: 0 },
      events: { inserted: 0, updated: 0, unchanged: 0 },
    });
    const machine = await t.run(async (ctx) => ctx.db.query("machines").unique());
    expect(machine?.lastSyncAt).toBe(T0 + 7_200_000);
    expect(await t.run(async (ctx) => ctx.db.query("dailyRollups").collect())).toHaveLength(0);
  });
});

describe("sync idempotence", () => {
  it("re-sending an identical batch inserts nothing and leaves the rollup untouched", async () => {
    const t = setup();
    const { userId, raw } = await userWithToken(t, "alice");
    const first = await postSync(t, raw, baseBatch());
    expect(first.status).toBe(200);
    const before = await getRollup(t, userId, "2026-08-31");

    vi.advanceTimersByTime(5 * 60_000);
    const second = await postSync(t, raw, baseBatch());
    expect(second.status).toBe(200);
    expect(second.json.accepted).toEqual({
      sessions: { inserted: 0, updated: 0, unchanged: 2 },
      events: { inserted: 0, updated: 0, unchanged: 3 },
    });
    const after = await getRollup(t, userId, "2026-08-31");
    expect(after?.computedAt).toBe(first.json.serverTime);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    expect(await t.run(async (ctx) => ctx.db.query("sessions").collect())).toHaveLength(2);
    expect(await t.run(async (ctx) => ctx.db.query("tokenEvents").collect())).toHaveLength(3);
  });

  it("replaces a session whose summaryHash changed and recomputes its day", async () => {
    const t = setup();
    const { userId, raw } = await userWithToken(t, "alice");
    await postSync(t, raw, baseBatch());
    vi.advanceTimersByTime(60_000);
    const changed = baseBatch();
    changed.sessions[0] = makeSession({ sessionId: "s1", turns: 9, summaryHash: "b".repeat(40) });
    const res = await postSync(t, raw, changed);
    expect(res.json.accepted.sessions).toEqual({ inserted: 0, updated: 1, unchanged: 1 });
    expect(await getRollup(t, userId, "2026-08-31")).toMatchObject({
      turns: 11,
      computedAt: res.json.serverTime,
    });
  });

  it("replaces a modified event and recomputes both its old and new day", async () => {
    const t = setup();
    const { userId, raw } = await userWithToken(t, "alice");
    await postSync(t, raw, baseBatch());
    vi.advanceTimersByTime(60_000);
    const changed = baseBatch();
    changed.tokenEvents = [
      makeEvent({ sessionId: "s1", seq: 7, day: "2026-09-01", hour: 1, output: 1000, total: 1500 }),
    ];
    const res = await postSync(t, raw, changed);
    expect(res.json.accepted.events).toEqual({ inserted: 0, updated: 1, unchanged: 0 });
    expect(res.json.accepted.sessions).toEqual({ inserted: 0, updated: 0, unchanged: 2 });
    expect(await getRollup(t, userId, "2026-08-31")).toMatchObject({
      responses: 2,
      computedAt: res.json.serverTime,
    });
    const day2 = await getRollup(t, userId, "2026-09-01");
    expect(day2).toMatchObject({ responses: 1, sessions: 0 });
    expect(day2?.tokens.total).toBe(1500);
  });

  it("patches inProgress and lineCount when the hash is unchanged", async () => {
    const t = setup();
    const { raw } = await userWithToken(t, "alice");
    await postSync(t, raw, makeBatch({
      sessions: [makeSession({ sessionId: "s1", inProgress: true, lineCount: 10 })],
    }));
    const res = await postSync(t, raw, makeBatch({
      sessions: [makeSession({ sessionId: "s1", inProgress: false, lineCount: 12 })],
    }));
    expect(res.json.accepted.sessions).toEqual({ inserted: 0, updated: 0, unchanged: 1 });
    const s1 = await t.run(async (ctx) =>
      ctx.db.query("sessions").withIndex("by_sessionId", (q) => q.eq("sessionId", "s1")).unique(),
    );
    expect(s1).toMatchObject({ inProgress: false, lineCount: 12 });
  });
});

describe("cross-user isolation", () => {
  it("reports another user's sessions and events as conflicts without merging", async () => {
    const t = setup();
    const alice = await userWithToken(t, "alice");
    const bob = await userWithToken(t, "bob");
    expect((await postSync(t, alice.raw, baseBatch())).status).toBe(200);

    const stolen = makeBatch({
      machine: makeMachine({ machineId: "machine-2" }),
      sessions: [
        makeSession({ sessionId: "s1", turns: 99, summaryHash: "c".repeat(40) }),
        makeSession({ sessionId: "s9" }),
      ],
      tokenEvents: [
        makeEvent({ sessionId: "s1", seq: 3, output: 1 }),
        makeEvent({ sessionId: "s9", seq: 1 }),
      ],
    });
    const res = await postSync(t, bob.raw, stolen);
    expect(res.status).toBe(200);
    expect(res.json.accepted).toEqual({
      sessions: { inserted: 1, updated: 0, unchanged: 0 },
      events: { inserted: 1, updated: 0, unchanged: 0 },
    });
    expect(res.json.conflicts).toEqual({ sessions: ["s1"], events: 1 });

    expect((await getRollup(t, alice.userId, "2026-08-31"))?.turns).toBe(4);
    const s1 = await t.run(async (ctx) =>
      ctx.db.query("sessions").withIndex("by_sessionId", (q) => q.eq("sessionId", "s1")).unique(),
    );
    expect(s1).toMatchObject({ userId: alice.userId, turns: 2 });
    expect(await getRollup(t, bob.userId, "2026-08-31")).toMatchObject({ sessions: 1, responses: 1 });
  });
});

describe("chunking", () => {
  it("ingests 2,500 events of one request through three mutations", async () => {
    const t = setup();
    const { userId, raw } = await userWithToken(t, "alice");
    const tokenEvents = Array.from({ length: 2500 }, (_, i) =>
      makeEvent({ sessionId: `s${i % 3}`, seq: i }),
    );
    const res = await postSync(t, raw, makeBatch({ tokenEvents }));
    expect(res.status).toBe(200);
    expect(res.json.accepted.events).toEqual({ inserted: 2500, updated: 0, unchanged: 0 });
    const rollup = await getRollup(t, userId, "2026-08-31");
    expect(rollup?.responses).toBe(2500);
    expect(rollup?.tokens.total).toBe(2500 * 600);
    expect(await t.run(async (ctx) => ctx.db.query("tokenEvents").collect())).toHaveLength(2500);
  }, 60_000);
});

describe("machine bookkeeping", () => {
  it("writes the token's lastUsedAt at most once per minute", async () => {
    const t = setup();
    const { raw, tokenId } = await userWithToken(t, "alice");
    const first = await postSync(t, raw, makeBatch());
    const firstUsed = (await t.run(async (ctx) => ctx.db.get(tokenId)))?.lastUsedAt;
    expect(firstUsed).toBe(first.json.serverTime);

    vi.advanceTimersByTime(30_000);
    await postSync(t, raw, makeBatch());
    expect((await t.run(async (ctx) => ctx.db.get(tokenId)))?.lastUsedAt).toBe(firstUsed);

    vi.advanceTimersByTime(31_000);
    const third = await postSync(t, raw, makeBatch());
    expect((await t.run(async (ctx) => ctx.db.get(tokenId)))?.lastUsedAt).toBe(third.json.serverTime);
  });

  it("keeps the newest rate-limit observation regardless of arrival order", async () => {
    const t = setup();
    const { raw } = await userWithToken(t, "alice");
    const newer = { observedAt: T0 + 100_000, usedPercent: 40, windowMinutes: 10080 };
    const older = { observedAt: T0 + 50_000, usedPercent: 35, windowMinutes: 10080 };
    const first = await postSync(t, raw, makeBatch({ rateLimit: newer }));
    vi.advanceTimersByTime(60_000);
    await postSync(t, raw, makeBatch({ rateLimit: older }));
    const machine = await t.run(async (ctx) => ctx.db.query("machines").first());
    expect(machine?.lastRateLimit).toEqual({ ...newer, receivedAt: first.json.serverTime });
    expect(machine?.lastSyncAt).toBe(first.json.serverTime + 60_000);
  });

  it("stores the hostname only when sent and clears it on null", async () => {
    const t = setup();
    const { raw } = await userWithToken(t, "alice");
    await postSync(t, raw, makeBatch({ machine: makeMachine({ hostname: "mac.local" }) }));
    expect((await t.run(async (ctx) => ctx.db.query("machines").first()))?.hostname).toBe("mac.local");
    await postSync(t, raw, makeBatch({ machine: makeMachine({ hostname: null }) }));
    expect((await t.run(async (ctx) => ctx.db.query("machines").first()))?.hostname).toBeUndefined();
  });
});
