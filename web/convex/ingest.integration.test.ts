import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
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
  withUser,
} from "./test.helpers";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(T0 + 7_200_000));
});
afterEach(() => vi.useRealTimers());

function baseBatch() {
  return makeBatch({
    sessions: [
      makeSession({ sessionId: "s1" }),
      makeSession({ sessionId: "s2", project: "project-b" }),
    ],
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
    await postSync(
      t,
      raw,
      makeBatch({
        sessions: [makeSession({ sessionId: "s1", inProgress: true, lineCount: 10 })],
      }),
    );
    const res = await postSync(
      t,
      raw,
      makeBatch({
        sessions: [makeSession({ sessionId: "s1", inProgress: false, lineCount: 12 })],
      }),
    );
    expect(res.json.accepted.sessions).toEqual({ inserted: 0, updated: 0, unchanged: 1 });
    const s1 = await t.run(async (ctx) =>
      ctx.db
        .query("sessions")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", "s1"))
        .unique(),
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
        // A different event for the same key; the token fields stay internally consistent
        // (reasoning ⊆ output, total = input + output) so only the ownership check can reject it.
        makeEvent({ sessionId: "s1", seq: 3, output: 1, reasoning: 1, total: 501 }),
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
      ctx.db
        .query("sessions")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", "s1"))
        .unique(),
    );
    expect(s1).toMatchObject({ userId: alice.userId, turns: 2 });
    expect(await getRollup(t, bob.userId, "2026-08-31")).toMatchObject({
      sessions: 1,
      responses: 1,
    });
  });

  it("refuses a brand-new event whose parent session belongs to another user", async () => {
    const t = setup();
    const alice = await userWithToken(t, "alice");
    const bob = await userWithToken(t, "bob");
    expect((await postSync(t, alice.raw, baseBatch())).status).toBe(200);

    // seq 42 is a key Alice never sent, so the (sessionId, seq) row does not exist and the
    // existing-row conflict branch cannot catch it: only the parent session's owner may write it.
    const res = await postSync(
      t,
      bob.raw,
      makeBatch({
        machine: makeMachine({ machineId: "machine-2" }),
        tokenEvents: [makeEvent({ sessionId: "s1", seq: 42 })],
      }),
    );
    expect(res.status).toBe(200);
    expect(res.json.accepted.events).toEqual({ inserted: 0, updated: 0, unchanged: 0 });
    expect(res.json.conflicts).toEqual({ sessions: [], events: 1 });
    expect(await t.run(async (ctx) => ctx.db.query("tokenEvents").collect())).toHaveLength(3);
    expect((await getRollup(t, bob.userId, "2026-08-31"))?.tokens.total ?? 0).toBe(0);
    expect((await getRollup(t, alice.userId, "2026-08-31"))?.tokens.total).toBe(1800);
  });

  it("still accepts events whose session summary has not arrived yet", async () => {
    const t = setup();
    const alice = await userWithToken(t, "alice");
    // The summary rides in a file's LAST batch, so first-batch events precede their session doc.
    const res = await postSync(
      t,
      alice.raw,
      makeBatch({ tokenEvents: [makeEvent({ sessionId: "never-summarised", seq: 0 })] }),
    );
    expect(res.status).toBe(200);
    expect(res.json.accepted.events).toEqual({ inserted: 1, updated: 0, unchanged: 0 });
    expect(res.json.conflicts.events).toBe(0);
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
    expect((await t.run(async (ctx) => ctx.db.get(tokenId)))?.lastUsedAt).toBe(
      third.json.serverTime,
    );
  });

  it("keeps the last-received snapshot even when a fast clock dated the previous one in the future", async () => {
    const t = setup();
    const { raw } = await userWithToken(t, "alice");
    // A laptop resumes from suspend with its RTC 500 days fast, then NTP corrects it a minute later.
    const skewed = { observedAt: Date.UTC(2028, 0, 1), usedPercent: 5, windowMinutes: 10080 };
    const corrected = { observedAt: T0 + 50_000, usedPercent: 92, windowMinutes: 10080 };
    const first = await postSync(t, raw, makeBatch({ rateLimit: skewed }));
    vi.advanceTimersByTime(60_000);
    const second = await postSync(t, raw, makeBatch({ rateLimit: corrected }));

    const machine = await t.run(async (ctx) => ctx.db.query("machines").first());
    expect(machine?.lastRateLimit).toEqual({ ...corrected, receivedAt: second.json.serverTime });
    expect(machine?.lastSyncAt).toBe(first.json.serverTime + 60_000);
    expect(await withUser(t, "alice").query(api.stats.quota, {})).toMatchObject({
      usedPercent: 92,
      observedAt: corrected.observedAt,
      receivedAt: second.json.serverTime,
    });
  });

  it("clamps an out-of-range usedPercent instead of failing the sync", async () => {
    const t = setup();
    const { raw } = await userWithToken(t, "alice");
    // The quota reading is incidental to a sync and must never fail one, so it is clamped, not
    // rejected — an unclamped 4000 would be echoed straight to the gauge.
    const res = await postSync(
      t,
      raw,
      makeBatch({
        rateLimit: { observedAt: T0, usedPercent: 4000, windowMinutes: 10080 },
      }),
    );
    expect(res.status).toBe(200);
    const machine = await t.run(async (ctx) => ctx.db.query("machines").first());
    expect(machine?.lastRateLimit?.usedPercent).toBe(100);
    expect(await withUser(t, "alice").query(api.stats.quota, {})).toMatchObject({
      usedPercent: 100,
    });
  });

  it("stores the hostname only when sent and clears it on null", async () => {
    const t = setup();
    const { raw } = await userWithToken(t, "alice");
    await postSync(t, raw, makeBatch({ machine: makeMachine({ hostname: "mac.local" }) }));
    expect((await t.run(async (ctx) => ctx.db.query("machines").first()))?.hostname).toBe(
      "mac.local",
    );
    await postSync(t, raw, makeBatch({ machine: makeMachine({ hostname: null }) }));
    expect(
      (await t.run(async (ctx) => ctx.db.query("machines").first()))?.hostname,
    ).toBeUndefined();
  });
});

/**
 * The `token_usage_record` flip, over the real incremental protocol. A live rollout file is
 * re-parsed and re-uploaded on every tick, and the reader skips its trailing partial line — so a
 * pass that ends before the file's first `token_usage_record` ships `token_count`-derived events
 * that the next pass supersedes locally but, with no delete path, could never retract on the
 * server. The numbers are the project's own b3 fixture: `token_count` 1008 at seq 4, then
 * `token_usage_record` 320 at seq 5.
 */
describe("token_usage_record supersedes token_count across parses", () => {
  const COUNT_TOKENS = {
    input: 999,
    cachedInput: 0,
    cacheWrite: 0,
    output: 9,
    reasoning: 0,
    total: 1008,
  };
  const RECORD_TOKENS = {
    input: 300,
    cachedInput: 100,
    cacheWrite: 0,
    output: 20,
    reasoning: 5,
    total: 320,
  };

  /** Pass 1: the file ends at seq 4, so the summary and its one event are still `count`-derived. */
  const countPass = () =>
    makeBatch({
      sessions: [
        makeSession({
          sessionId: "b3",
          eventOrigin: "count",
          tokens: COUNT_TOKENS,
          responses: 1,
          inProgress: true,
          lineCount: 5,
          summaryHash: "c".repeat(40),
        }),
      ],
      tokenEvents: [makeEvent({ sessionId: "b3", seq: 4, origin: "count", ...COUNT_TOKENS })],
    });

  /** Pass 2: the file is complete, so only seq 5 is emitted and only `record` events are valid. */
  const recordPass = () =>
    makeBatch({
      batchId: "batch-2",
      sessions: [
        makeSession({
          sessionId: "b3",
          eventOrigin: "record",
          tokens: RECORD_TOKENS,
          responses: 1,
          inProgress: false,
          lineCount: 11,
          summaryHash: "d".repeat(40),
        }),
      ],
      tokenEvents: [makeEvent({ sessionId: "b3", seq: 5, origin: "record", ...RECORD_TOKENS })],
    });

  it("deletes the superseded count events and repairs the day's rollup", async () => {
    const t = setup();
    const { userId, raw } = await userWithToken(t, "alice");
    expect((await postSync(t, raw, countPass())).status).toBe(200);
    expect(await getRollup(t, userId, "2026-08-31")).toMatchObject({ responses: 1 });

    vi.advanceTimersByTime(60_000);
    expect((await postSync(t, raw, recordPass())).status).toBe(200);

    // Without the purge the day reads 1008 + 320 = 1328 tokens over 2 responses, for a session
    // that made one 320-token response — the Total-tokens card and the Machines table disagree.
    const rollup = await getRollup(t, userId, "2026-08-31");
    expect(rollup?.tokens.total).toBe(320);
    expect(rollup?.responses).toBe(1);
    const stored = await t.run(async (ctx) => ctx.db.query("tokenEvents").collect());
    expect(stored.map((e) => e.seq)).toEqual([5]);
  });

  it("is idempotent: replaying the record pass changes nothing", async () => {
    const t = setup();
    const { userId, raw } = await userWithToken(t, "alice");
    await postSync(t, raw, countPass());
    vi.advanceTimersByTime(60_000);
    await postSync(t, raw, recordPass());
    const before = await getRollup(t, userId, "2026-08-31");

    vi.advanceTimersByTime(60_000);
    const replay = await postSync(t, raw, recordPass());
    expect(replay.json.accepted).toEqual({
      sessions: { inserted: 0, updated: 0, unchanged: 1 },
      events: { inserted: 0, updated: 0, unchanged: 1 },
    });
    expect(await t.run(async (ctx) => ctx.db.query("tokenEvents").collect())).toHaveLength(1);
    expect(JSON.stringify(await getRollup(t, userId, "2026-08-31"))).toBe(JSON.stringify(before));
  });

  it("leaves a session that never emitted a record event alone", async () => {
    const t = setup();
    const { userId, raw } = await userWithToken(t, "alice");
    await postSync(t, raw, countPass());
    const before = await getRollup(t, userId, "2026-08-31");

    vi.advanceTimersByTime(60_000);
    const grown = countPass();
    grown.batchId = "batch-2";
    grown.tokenEvents = [makeEvent({ sessionId: "b3", seq: 6, origin: "count", ...COUNT_TOKENS })];
    grown.sessions = [
      makeSession({
        sessionId: "b3",
        eventOrigin: "count",
        responses: 2,
        inProgress: true,
        lineCount: 7,
        tokens: {
          input: 1998,
          cachedInput: 0,
          cacheWrite: 0,
          output: 18,
          reasoning: 0,
          total: 2016,
        },
        summaryHash: "e".repeat(40),
      }),
    ];
    expect((await postSync(t, raw, grown)).status).toBe(200);
    const stored = await t.run(async (ctx) => ctx.db.query("tokenEvents").collect());
    expect(stored.map((e) => e.seq).sort()).toEqual([4, 6]);
    const rollup = await getRollup(t, userId, "2026-08-31");
    expect(rollup?.tokens.total).toBe(2016);
    expect(rollup?.responses).toBe(2);
    expect(before?.responses).toBe(1);
  });

  it("never deletes another user's events for the same sessionId", async () => {
    // The purge is the ingest's only delete path, and it runs on the branch where no session
    // document exists yet — which is exactly the state `upsertEvents` deliberately allows another
    // user's events to sit in ("events may arrive before their summary"). Alice's run dies before
    // the batch carrying her summary; Bob then posts a `record` summary for the same id. Without
    // an ownership filter Alice loses her rows AND her rollup is never recomputed, so it counts
    // events that no longer exist — silent and undetectable.
    const t = setup();
    const alice = await userWithToken(t, "alice");
    const bob = await userWithToken(t, "bob");
    const orphan = makeBatch({
      tokenEvents: [makeEvent({ sessionId: "b3", seq: 4, origin: "count", ...COUNT_TOKENS })],
    });
    expect((await postSync(t, alice.raw, orphan)).status).toBe(200);

    vi.advanceTimersByTime(60_000);
    const theirs = recordPass();
    theirs.machine = makeMachine({ machineId: "machine-2" });
    expect((await postSync(t, bob.raw, theirs)).status).toBe(200);

    const stored = await t.run(async (ctx) => ctx.db.query("tokenEvents").collect());
    expect(stored.filter((e) => e.userId === alice.userId).map((e) => e.seq)).toEqual([4]);
    expect(await getRollup(t, alice.userId, "2026-08-31")).toMatchObject({ responses: 1 });
  });
});
