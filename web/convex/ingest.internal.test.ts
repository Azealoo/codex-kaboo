import { describe, expect, it } from "vitest";
import { addDays } from "../../shared/src/days";
import { internal } from "./_generated/api";
import { chunkEvents, chunkSessions, eventsEqual } from "./ingest";
import {
  getRollup,
  makeEvent,
  makeMachine,
  makeSession,
  registerUser,
  setup,
  T0,
  userWithToken,
} from "./test.helpers";

describe("chunkEvents", () => {
  it("splits by 1,000 events and by 10 distinct days, preserving order", () => {
    const sameDay = Array.from({ length: 2500 }, (_, i) => makeEvent({ sessionId: "s", seq: i }));
    expect(chunkEvents(sameDay).map((c) => c.length)).toEqual([1000, 1000, 500]);
    expect(chunkEvents(sameDay).flat().map((e) => e.seq)).toEqual(sameDay.map((e) => e.seq));
    const manyDays = Array.from({ length: 35 }, (_, i) =>
      makeEvent({ sessionId: "s", seq: i, day: addDays("2026-06-01", i) }),
    );
    expect(chunkEvents(manyDays).map((c) => c.length)).toEqual([10, 10, 10, 5]);
    expect(chunkEvents([])).toEqual([]);
  });
});

describe("chunkSessions", () => {
  it("splits by 200 sessions and by 10 distinct days, preserving order", () => {
    const sameDay = Array.from({ length: 450 }, (_, i) => makeSession({ sessionId: `s-${i}` }));
    expect(chunkSessions(sameDay).map((c) => c.length)).toEqual([200, 200, 50]);
    const manyDays = Array.from({ length: 45 }, (_, i) =>
      makeSession({ sessionId: `d-${i}`, day: addDays("2026-06-01", i) }),
    );
    expect(chunkSessions(manyDays).map((c) => c.length)).toEqual([10, 10, 10, 10, 5]);
    expect(chunkSessions(manyDays).flat().map((s) => s.sessionId)).toEqual(
      manyDays.map((s) => s.sessionId),
    );
    expect(chunkSessions([])).toEqual([]);
  });
});

describe("eventsEqual", () => {
  it("compares every payload field, treating absent optionals as equal", () => {
    const a = makeEvent({ sessionId: "s", seq: 1 });
    expect(eventsEqual(a, { ...a })).toBe(true);
    expect(eventsEqual(a, { ...a, output: a.output + 1 })).toBe(false);
    const noEffort = { ...a };
    delete noEffort.effort;
    expect(eventsEqual(a, noEffort)).toBe(false);
    expect(eventsEqual(noEffort, { ...noEffort })).toBe(true);
  });
});

describe("upsertMachine", () => {
  it("registers, updates versions but never the label or lastSyncAt, clears hostname on null, rejects other users", async () => {
    const t = setup();
    const alice = await registerUser(t, "alice");
    const bob = await registerUser(t, "bob");
    const first = await t.mutation(internal.ingest.upsertMachine, {
      userId: alice, machine: makeMachine(), cliVersion: "0.1.0", now: T0,
    });
    expect(first).toEqual({ conflict: false, created: true });

    // lastSyncAt is seeded on insert (T0) and, per the fix below, never touched by a later patch —
    // only `finishSync` advances it, so it stays T0 through every upsertMachine call in this test.
    const second = await t.mutation(internal.ingest.upsertMachine, {
      userId: alice,
      machine: makeMachine({ label: "renamed-by-cli", hostname: "mac.local", codexVersion: "0.151.0" }),
      cliVersion: "0.2.0",
      now: T0 + 1,
    });
    expect(second).toEqual({ conflict: false, created: false });
    const rows = await t.run(async (ctx) => ctx.db.query("machines").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      machineId: "machine-1", userId: alice, label: "brisk-otter", hostname: "mac.local",
      codexVersion: "0.151.0", cliVersion: "0.2.0", firstSeenAt: T0, lastSyncAt: T0,
    });

    await t.mutation(internal.ingest.upsertMachine, {
      userId: alice, machine: makeMachine({ hostname: null }), cliVersion: "0.2.0", now: T0 + 2,
    });
    const cleared = await t.run(async (ctx) => ctx.db.query("machines").first());
    expect(cleared?.hostname).toBeUndefined();
    expect(cleared?.lastSyncAt).toBe(T0);

    const conflict = await t.mutation(internal.ingest.upsertMachine, {
      userId: bob, machine: makeMachine({ label: "stolen" }), cliVersion: "0.2.0", now: T0 + 3,
    });
    expect(conflict).toEqual({ conflict: true, created: false });
    const after = await t.run(async (ctx) => ctx.db.query("machines").first());
    expect(after).toMatchObject({ userId: alice, lastSyncAt: T0 });
  });
});

describe("upsertSessions", () => {
  it("inserts, skips unchanged hashes, replaces changed sessions and reports conflicts", async () => {
    const t = setup();
    const alice = await registerUser(t, "alice");
    const bob = await registerUser(t, "bob");
    const s1 = makeSession({ sessionId: "s1" });

    const r1 = await t.mutation(internal.ingest.upsertSessions, {
      userId: alice, machineId: "machine-1", sessions: [s1], now: T0,
    });
    expect(r1).toEqual({ counts: { inserted: 1, updated: 0, unchanged: 0 }, conflicts: [] });
    expect(await getRollup(t, alice, "2026-08-31")).toMatchObject({ sessions: 1, computedAt: T0 });

    const r2 = await t.mutation(internal.ingest.upsertSessions, {
      userId: alice, machineId: "machine-1",
      sessions: [{ ...s1, inProgress: true, lineCount: 41 }], now: T0 + 1,
    });
    expect(r2.counts).toEqual({ inserted: 0, updated: 0, unchanged: 1 });
    expect((await getRollup(t, alice, "2026-08-31"))?.computedAt).toBe(T0);
    const stored = await t.run(async (ctx) =>
      ctx.db.query("sessions").withIndex("by_sessionId", (q) => q.eq("sessionId", "s1")).unique(),
    );
    expect(stored).toMatchObject({ inProgress: true, lineCount: 41, syncedAt: T0 + 1 });

    const moved = {
      ...s1, day: "2026-09-01", startedAt: T0 + 86_400_000, turns: 5, summaryHash: "b".repeat(40),
    };
    const r3 = await t.mutation(internal.ingest.upsertSessions, {
      userId: alice, machineId: "machine-1", sessions: [moved], now: T0 + 2,
    });
    expect(r3.counts).toEqual({ inserted: 0, updated: 1, unchanged: 0 });
    expect(await getRollup(t, alice, "2026-08-31")).toBeNull();
    expect(await getRollup(t, alice, "2026-09-01")).toMatchObject({ sessions: 1, turns: 5, computedAt: T0 + 2 });
    expect(await t.run(async (ctx) => ctx.db.query("sessions").collect())).toHaveLength(1);

    const r4 = await t.mutation(internal.ingest.upsertSessions, {
      userId: bob, machineId: "machine-2", sessions: [{ ...moved, turns: 99 }], now: T0 + 3,
    });
    expect(r4).toEqual({ counts: { inserted: 0, updated: 0, unchanged: 0 }, conflicts: ["s1"] });
    expect(await getRollup(t, bob, "2026-09-01")).toBeNull();
    expect((await getRollup(t, alice, "2026-09-01"))?.turns).toBe(5);
  });
});

describe("upsertEvents", () => {
  it("inserts, skips identical events, replaces modified ones touching both days, reports conflicts", async () => {
    const t = setup();
    const alice = await registerUser(t, "alice");
    const bob = await registerUser(t, "bob");
    const e1 = makeEvent({ sessionId: "s1", seq: 1 });
    const e2 = makeEvent({ sessionId: "s1", seq: 2, hour: 10 });

    const r1 = await t.mutation(internal.ingest.upsertEvents, { userId: alice, machineId: "machine-1", events: [e1, e2], now: T0 });
    expect(r1).toEqual({ counts: { inserted: 2, updated: 0, unchanged: 0 }, conflicts: 0 });
    expect(await getRollup(t, alice, "2026-08-31")).toMatchObject({ responses: 2, computedAt: T0 });

    const r2 = await t.mutation(internal.ingest.upsertEvents, { userId: alice, machineId: "machine-1", events: [e1, e2], now: T0 + 1 });
    expect(r2.counts).toEqual({ inserted: 0, updated: 0, unchanged: 2 });
    expect((await getRollup(t, alice, "2026-08-31"))?.computedAt).toBe(T0);

    const movedE2 = { ...e2, day: "2026-09-01", hour: 0, output: 999, total: 1499 };
    const r3 = await t.mutation(internal.ingest.upsertEvents, { userId: alice, machineId: "machine-1", events: [movedE2], now: T0 + 2 });
    expect(r3.counts).toEqual({ inserted: 0, updated: 1, unchanged: 0 });
    expect(await getRollup(t, alice, "2026-08-31")).toMatchObject({ responses: 1, computedAt: T0 + 2 });
    const day2 = await getRollup(t, alice, "2026-09-01");
    expect(day2).toMatchObject({ responses: 1, computedAt: T0 + 2 });
    expect(day2?.tokens.total).toBe(1499);
    expect(await t.run(async (ctx) => ctx.db.query("tokenEvents").collect())).toHaveLength(2);

    const r4 = await t.mutation(internal.ingest.upsertEvents, {
      userId: bob, machineId: "machine-1", events: [{ ...e1, output: 5, reasoning: 5, total: 505 }], now: T0 + 3,
    });
    expect(r4).toEqual({ counts: { inserted: 0, updated: 0, unchanged: 0 }, conflicts: 1 });
    expect(await getRollup(t, bob, "2026-08-31")).toBeNull();
  });
});

describe("upsertEvents session-owner memoisation", () => {
  // Pins the `sessionOwners` cache (ingest.ts) that makes a session's owner get looked up at most
  // once per distinct sessionId, not once per event: without it, a 1,000-event chunk over a
  // handful of sessions would spend one `by_sessionId` index read PER EVENT instead of per
  // session, quietly restoring the read pressure the cache exists to relieve.
  //
  // convex-test has no direct "spy on this index read" hook, but it does implement Convex's real
  // `ctx.meta.getTransactionMetrics()` (convex/server, @public) faithfully enough to use here: a
  // nested `ctx.runMutation` opens a child transaction-metrics layer that folds back into its
  // caller's on commit (convex-test's TransactionMetricsTracker), so wrapping the call to
  // `upsertEvents` in an outer mutation and reading `getTransactionMetrics()` right after reports
  // every index range `upsertEvents` opened — a genuine read count, not a correctness proxy.
  it("looks up each session's owner once per distinct session, not once per event", async () => {
    const t = setup();
    const alice = await registerUser(t, "alice");
    const sessionIds = ["s0", "s1", "s2"];
    const events = Array.from({ length: 12 }, (_, i) =>
      makeEvent({ sessionId: sessionIds[i % sessionIds.length], seq: i }),
    );

    const { metrics } = await t.mutation(async (ctx) => {
      await ctx.runMutation(internal.ingest.upsertEvents, { userId: alice, machineId: "machine-1", events, now: T0 });
      return { metrics: await ctx.meta.getTransactionMetrics() };
    });

    // Two OTHER fixed costs share this same total, neither of which the cache under test touches:
    // one `by_session_seq` range per event (the existing-tokenEvent check, always a miss here since
    // every event is new), and exactly 3 more for the single touched day's `recomputeDay` (its
    // `by_user_day` ranges over tokenEvents, sessions and dailyRollups — verified against this
    // scenario's `documentsRead.used` of 12, which is exactly the 12 just-inserted events that one
    // `.collect()` reads back and nothing else). Subtracting both isolates the session-owner
    // lookups, which is the number this test exists to pin.
    const ownerLookups = metrics.databaseQueries.used - events.length - 3;
    expect(ownerLookups).toBe(sessionIds.length);
  });
});

describe("finishSync", () => {
  it("updates lastSyncAt, keeps the newest snapshot by receivedAt (server clock), touches the token", async () => {
    const t = setup();
    const { userId, tokenId } = await userWithToken(t, "alice");
    await t.mutation(internal.ingest.upsertMachine, {
      userId, machine: makeMachine(), cliVersion: "0.1.0", now: T0,
    });
    const snapshot = {
      observedAt: T0 - 60_000, usedPercent: 12.5, windowMinutes: 10080,
      resetsAt: T0 + 6 * 86_400_000, planType: "team", limitId: "primary",
    };
    const r1 = await t.mutation(internal.ingest.finishSync, {
      userId, machineId: "machine-1", tokenId, rateLimit: snapshot, now: T0 + 5,
    });
    expect(r1).toEqual({ rateLimitStored: true, tokenTouched: true });
    const m1 = await t.run(async (ctx) => ctx.db.query("machines").first());
    expect(m1).toMatchObject({ lastSyncAt: T0 + 5, lastRateLimit: { ...snapshot, receivedAt: T0 + 5 } });

    // The client's observedAt never decides: a snapshot that arrives later replaces the stored one
    // even when its own clock says it is older, so one machine's forward skew cannot freeze the
    // gauge (design spec: store when `receivedAt` is newer — server clock, never the client's).
    const older = { ...snapshot, observedAt: T0 - 120_000, usedPercent: 99 };
    const r2 = await t.mutation(internal.ingest.finishSync, {
      userId, machineId: "machine-1", tokenId, rateLimit: older, now: T0 + 10,
    });
    expect(r2).toEqual({ rateLimitStored: true, tokenTouched: false });
    const m2 = await t.run(async (ctx) => ctx.db.query("machines").first());
    expect(m2).toMatchObject({ lastSyncAt: T0 + 10, lastRateLimit: { ...older, receivedAt: T0 + 10 } });

    const r3 = await t.mutation(internal.ingest.finishSync, {
      userId, machineId: "machine-1", tokenId, now: T0 + 70_000,
    });
    expect(r3).toEqual({ rateLimitStored: false, tokenTouched: true });
    const token = await t.run(async (ctx) => ctx.db.get(tokenId));
    expect(token?.lastUsedAt).toBe(T0 + 70_000);
  });
});

describe("counts", () => {
  it("reports table sizes", async () => {
    const t = setup();
    const alice = await registerUser(t, "alice");
    await t.mutation(internal.ingest.upsertSessions, {
      userId: alice, machineId: "machine-1", sessions: [makeSession({ sessionId: "s1" })], now: T0,
    });
    await t.mutation(internal.ingest.upsertEvents, {
      userId: alice, machineId: "machine-1", events: [makeEvent({ sessionId: "s1", seq: 1 }), makeEvent({ sessionId: "s1", seq: 2 })], now: T0,
    });
    expect(await t.query(internal.ingest.counts, {})).toEqual({
      sessions: 1,
      tokenEvents: 2,
      dailyRollups: 1,
      capped: { sessions: false, tokenEvents: false, dailyRollups: false },
    });
  });
});

describe("upsertEvents machine stamping", () => {
  // `machineId` is stamped by the server from the batch's machine block, never sent per event —
  // the same shape `sessions` has always used. A machine is constant for a whole batch by
  // construction, so a per-event copy is redundant bytes on every one of up to 5,000 events, and
  // it is a required wire field the CLI cannot fill before login (it had to reach for a
  // placeholder id on the `--dry-run` path). Stamping also makes it structurally impossible for an
  // event to claim a different machine than the batch it arrived in.
  it("stamps the batch's machineId onto every event", async () => {
    const t = setup();
    const alice = await registerUser(t, "alice");
    await t.mutation(internal.ingest.upsertEvents, {
      userId: alice,
      machineId: "machine-b",
      events: [makeEvent({ sessionId: "s1", seq: 1 }), makeEvent({ sessionId: "s1", seq: 2 })],
      now: T0,
    });
    const stored = await t.run(async (ctx) => ctx.db.query("tokenEvents").collect());
    expect(stored.map((e) => e.machineId)).toEqual(["machine-b", "machine-b"]);
  });

  // `source` IS a payload field, so it has to take part in the equality check that decides
  // insert/unchanged/replace. Left out, a parser fix that corrects a source — exactly what the
  // `subagent:<kind>` guard does — could never reach rows already uploaded: the re-upload would be
  // judged unchanged and the stale value would stand forever, `--full` included.
  it("replaces an event whose source was corrected by a newer parser", async () => {
    const t = setup();
    const alice = await registerUser(t, "alice");
    const before = makeEvent({ sessionId: "s1", seq: 1, source: "unknown" });
    await t.mutation(internal.ingest.upsertEvents, {
      userId: alice, machineId: "machine-a", events: [before], now: T0,
    });

    const after = await t.mutation(internal.ingest.upsertEvents, {
      userId: alice,
      machineId: "machine-a",
      events: [{ ...before, source: "subagent:guardian" }],
      now: T0 + 1,
    });
    expect(after.counts).toEqual({ inserted: 0, updated: 1, unchanged: 0 });
    const stored = await t.run(async (ctx) => ctx.db.query("tokenEvents").collect());
    expect(stored.map((e) => e.source)).toEqual(["subagent:guardian"]);
  });
});
