import { describe, expect, it } from "vitest";
import { ROLLUP_VERSION } from "../../shared/src/constants";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { EventInput, SessionInput } from "./lib/aggregate";
import { loadRollups } from "./stats";
import {
  withUser,
  registerUser,
  seedRollup,
  setup,
  ZERO_TOOLS,
  type Harness,
} from "./test.helpers";

const ev = (o: Partial<EventInput> = {}): EventInput => ({
  hour: 9,
  model: "gpt-5.6-sol",
  effort: "medium",
  project: "alpha",
  machineId: "machine-1",
  source: "cli",
  isSubagent: false,
  input: 1000,
  cachedInput: 400,
  cacheWrite: 0,
  output: 200,
  reasoning: 50,
  total: 1200,
  ...o,
});
const ses = (o: Partial<SessionInput> = {}): SessionInput => ({
  machineId: "machine-1",
  project: "alpha",
  source: "cli",
  isSubagent: false,
  turns: 2,
  userMessages: 2,
  agentMessages: 2,
  linesAdded: 10,
  linesRemoved: 2,
  filesChanged: 1,
  compactions: 0,
  activeMs: 600_000,
  wallMs: 3_600_000,
  ttft: { count: 2, sumMs: 1500, hist: [0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  toolCounts: { ...ZERO_TOOLS, commandRead: 3 },
  mcpTools: [],
  skills: [],
  tokens: { input: 1000, cachedInput: 400, cacheWrite: 0, output: 200, reasoning: 50, total: 1200 },
  ...o,
});

async function seedPrices(t: Harness) {
  await t.run(async (ctx) => {
    await ctx.db.insert("modelPrices", {
      model: "gpt-5.6-sol",
      inputUsdPerMTok: 2,
      cachedInputUsdPerMTok: 0.2,
      outputUsdPerMTok: 10,
      source: "seed",
      updatedAt: 1,
    });
  });
}

/** alice: 08-29 (1 event), 08-30 (1 event + 1 session), 08-31 (2 events + 1 session); bob: 08-31 sub-agent only. */
async function seedTeam(t: Harness): Promise<{ alice: Id<"users">; bob: Id<"users"> }> {
  const alice = await registerUser(t, "alice");
  const bob = await registerUser(t, "bob");
  await seedPrices(t);
  await seedRollup(t, alice, "2026-08-29", [ev()], []);
  await seedRollup(t, alice, "2026-08-30", [ev()], [ses()]);
  await seedRollup(t, alice, "2026-08-31", [ev(), ev({ hour: 10 })], [ses({ project: "beta" })]);
  await seedRollup(
    t,
    bob,
    "2026-08-31",
    [
      ev({
        model: "codex-auto-review",
        effort: undefined,
        isSubagent: true,
        machineId: "machine-2",
        source: "subagent:review",
      }),
    ],
    [ses({ isSubagent: true, source: "subagent:review", machineId: "machine-2" })],
  );
  return { alice, bob };
}

describe("stats.summary", () => {
  it("folds the team's rollups and compares with the previous period", async () => {
    const t = setup();
    await seedTeam(t);
    const s = await withUser(t, "alice").query(api.stats.summary, {
      from: "2026-08-30",
      to: "2026-08-31",
    });
    expect(s.range).toEqual({ from: "2026-08-30", to: "2026-08-31" });
    expect(s.previousRange).toEqual({ from: "2026-08-28", to: "2026-08-29" });
    expect(s.tokens).toEqual({
      input: 4000,
      cachedInput: 1600,
      cacheWrite: 0,
      output: 800,
      reasoning: 200,
      total: 4800,
    });
    expect(s.previousTokens?.total).toBe(1200);
    expect(s.metrics.totalTokens).toEqual({ current: 4800, previous: 1200, change: 3 });
    expect(s.metrics.sessions).toEqual({ current: 2, previous: 0, change: null });
    expect(s.metrics.subagentTokens.current).toBe(1200);
    // The rollup has counted sub-agent sessions since day one but never exposed them, so the
    // README's "excluded from session counts" rule could not be checked against anything. Bob's
    // 08-31 rollup is sub-agent only: it is the 1 here and the reason `sessions` above is 2, not 3.
    expect(s.metrics.subagentSessions.current).toBe(1);
    expect(s.metrics.messages.current).toBe(8);
    expect(s.metrics.tokensPerTurn.current).toBe(1200);
    expect(s.metrics.tokensPerLine.current).toBe(240);
    expect(s.metrics.cacheHitRate).toEqual({ current: 0.4, previous: 0.4, change: 0 });
    expect(s.metrics.activeDays).toEqual({ current: 2, previous: 1, change: 1 });
    expect(s.metrics.ttftAvgMs.current).toBe(750);
    expect(s.metrics.ttftP50Ms.current).toBeGreaterThan(0);
    expect(s.metrics.costUsd.current).toBeCloseTo(0.00984, 8);
    expect(s.metrics.costUsd.previous).toBeCloseTo(0.00328, 8);
    expect(s.metrics.costUsd.change).toBeCloseTo(2, 8);
    expect(s.costByKind.reasoning).toBeCloseTo(0.0015, 8);
    expect(s.cacheSavingsUsd).toBeCloseTo(0.00216, 8);
    expect(s.unpricedModels).toEqual(["codex-auto-review"]);
    expect(s.staleRollupDays).toBe(0);
  });

  // Re-review NEW-2: `version` was written on every rollup and read by nothing. Rollups are only
  // recomputed for days a sync touches, so after a ROLLUP_VERSION bump a quiet day keeps the old
  // version's numbers and the read path served them as current — the session-basis byMachine bug
  // would have survived its own fix on every day nothing re-synced. `rebuildAll` is the repair;
  // this count is the only thing that says it is needed.
  it("counts rollups in range that were computed under an older ROLLUP_VERSION", async () => {
    const t = setup();
    const { alice } = await seedTeam(t);
    await t.run(async (ctx) => {
      const stale = await ctx.db
        .query("dailyRollups")
        .withIndex("by_user_day", (q) => q.eq("userId", alice).eq("day", "2026-08-30"))
        .unique();
      await ctx.db.patch(stale!._id, { version: ROLLUP_VERSION - 1 });
    });
    const s = await withUser(t, "alice").query(api.stats.summary, {
      from: "2026-08-30",
      to: "2026-08-31",
    });
    expect(s.staleRollupDays).toBe(1);
    // Scoped to the range on screen: a stale day outside it is somebody else's warning.
    const later = await withUser(t, "alice").query(api.stats.summary, {
      from: "2026-08-31",
      to: "2026-08-31",
    });
    expect(later.staleRollupDays).toBe(0);
  });

  it("scopes to one user and can skip the previous period", async () => {
    const t = setup();
    const { alice } = await seedTeam(t);
    const mine = await withUser(t, "bob").query(api.stats.summary, {
      from: "2026-08-30",
      to: "2026-08-31",
      userId: alice,
    });
    expect(mine.metrics.totalTokens).toEqual({ current: 3600, previous: 1200, change: 2 });
    expect(mine.metrics.sessions.current).toBe(2);
    expect(mine.unpricedModels).toEqual([]);

    const all = await withUser(t, "alice").query(api.stats.summary, {
      from: "2026-08-30",
      to: "2026-08-31",
      previous: false,
    });
    expect(all.previousRange).toBeNull();
    expect(all.previousTokens).toBeNull();
    expect(all.metrics.totalTokens).toEqual({ current: 4800, previous: null, change: null });
  });

  it("returns zeros for an empty range and rejects bad ranges and anonymous callers", async () => {
    const t = setup();
    await seedTeam(t);
    const empty = await withUser(t, "alice").query(api.stats.summary, {
      from: "2025-01-01",
      to: "2025-01-07",
    });
    expect(empty.metrics.totalTokens).toEqual({ current: 0, previous: 0, change: null });
    expect(empty.metrics.cacheHitRate).toEqual({ current: null, previous: null, change: null });
    await expect(
      withUser(t, "alice").query(api.stats.summary, { from: "2026-08-31", to: "2026-08-30" }),
    ).rejects.toMatchObject({ data: { code: "bad_range" } });
    await expect(
      t.query(api.stats.summary, { from: "2026-08-30", to: "2026-08-31" }),
    ).rejects.toMatchObject({
      data: { code: "unauthenticated" },
    });
  });

  it("distinguishes a genuine zero cache hit rate from an undefined one", async () => {
    const t = setup();
    const alice = await registerUser(t, "alice");
    // Input tokens present, none of them cached: a real, measured 0% hit rate.
    await seedRollup(t, alice, "2026-08-31", [ev({ cachedInput: 0 })], []);
    const withInput = await withUser(t, "alice").query(api.stats.summary, {
      from: "2026-08-31",
      to: "2026-08-31",
      previous: false,
    });
    expect(withInput.metrics.cacheHitRate.current).toBe(0);
    // No input tokens at all in this range: the rate has no denominator, so it is undefined.
    const withoutInput = await withUser(t, "alice").query(api.stats.summary, {
      from: "2025-01-01",
      to: "2025-01-07",
      previous: false,
    });
    expect(withoutInput.metrics.cacheHitRate.current).toBeNull();
    // The two must be distinguishable — a null-coalesced convention could not tell them apart.
    expect(withInput.metrics.cacheHitRate.current).not.toBe(
      withoutInput.metrics.cacheHitRate.current,
    );
  });
});

describe("stats.leaderboard", () => {
  it("ranks users by tokens with previous-period ranks and null for newcomers", async () => {
    const t = setup();
    const { alice, bob } = await seedTeam(t);
    const board = await withUser(t, "alice").query(api.stats.leaderboard, {
      from: "2026-08-30",
      to: "2026-08-31",
    });
    expect(board.previousRange).toEqual({ from: "2026-08-28", to: "2026-08-29" });
    expect(board.rows).toHaveLength(2);
    expect(board.rows[0]).toMatchObject({
      userId: alice,
      name: "Alice",
      imageUrl: null,
      rank: 1,
      previousRank: 1,
      previousTokens: 1200,
      change: 2,
      sessions: 2,
      turns: 4,
      messages: 8,
      userMessages: 4,
      linesAdded: 20,
      linesRemoved: 4,
      tokensPerLine: 180,
      cacheHitRate: 0.4,
      activeMs: 1_200_000,
      unpriced: false,
    });
    expect(board.rows[0]?.tokens.total).toBe(3600);
    expect(board.rows[0]?.costUsd).toBeCloseTo(0.00984, 8);
    expect(board.rows[1]).toMatchObject({
      userId: bob,
      name: "Bob",
      rank: 2,
      previousRank: null,
      previousTokens: null,
      change: null,
      sessions: 0,
      costUsd: 0,
      unpriced: true,
      tokensPerLine: null,
    });
    expect(board.rows[1]?.tokens.total).toBe(1200);
  });

  it("breaks ties by name and omits previous ranks when previous is false", async () => {
    const t = setup();
    const alice = await registerUser(t, "alice");
    const bob = await registerUser(t, "bob");
    await seedRollup(t, bob, "2026-08-31", [ev()], []);
    await seedRollup(t, alice, "2026-08-31", [ev()], []);
    const board = await withUser(t, "alice").query(api.stats.leaderboard, {
      from: "2026-08-31",
      to: "2026-08-31",
      previous: false,
    });
    expect(board.previousRange).toBeNull();
    expect(board.rows.map((r) => [r.name, r.rank, r.previousRank])).toEqual([
      ["Alice", 1, null],
      ["Bob", 2, null],
    ]);
    expect(
      await withUser(t, "alice").query(api.stats.leaderboard, {
        from: "2025-01-01",
        to: "2025-01-01",
      }),
    ).toMatchObject({ rows: [] });
  });
});

describe("loadRollups document cap", () => {
  it("throws range_too_large past the cap, in both team and user scope", async () => {
    const t = setup();
    const alice = await registerUser(t, "alice");
    await seedRollup(t, alice, "2026-08-29", [ev()], []);
    await seedRollup(t, alice, "2026-08-30", [ev()], []);
    await seedRollup(t, alice, "2026-08-31", [ev()], []);
    const range = { from: "2026-08-29", to: "2026-08-31" };
    await expect(t.run(async (ctx) => loadRollups(ctx, range, undefined, 2))).rejects.toMatchObject(
      { data: { code: "range_too_large", days: 3, docs: 2 } },
    );
    await expect(t.run(async (ctx) => loadRollups(ctx, range, alice, 2))).rejects.toMatchObject({
      data: { code: "range_too_large", days: 3, docs: 2 },
    });
  });

  it("does not trip the cap for an ordinary-sized range", async () => {
    const t = setup();
    await seedTeam(t);
    const range = { from: "2026-08-29", to: "2026-08-31" };
    const rows = await t.run(async (ctx) => loadRollups(ctx, range, undefined));
    expect(rows).toHaveLength(4);
  });
});

describe("stats.trends", () => {
  it("zero-fills daily buckets and reports per-user, per-model series and the peak", async () => {
    const t = setup();
    const { alice, bob } = await seedTeam(t);
    const r = await withUser(t, "alice").query(api.stats.trends, {
      from: "2026-08-29",
      to: "2026-08-31",
      bucket: "day",
    });
    expect(r.bucket).toBe("day");
    expect(r.points.map((p) => [p.bucket, p.total])).toEqual([
      ["2026-08-29", 1200],
      ["2026-08-30", 1200],
      ["2026-08-31", 3600],
    ]);
    const last = r.points[2]!;
    expect(last.sessions).toBe(1);
    expect(last.activeMs).toBe(600_000);
    expect(last.costUsd).toBeCloseTo(0.00656, 8);
    expect(last.byUser).toHaveLength(2);
    expect(last.byUser.find((u) => u.key === alice)).toMatchObject({
      tokens: 2400,
      activeMs: 600_000,
    });
    expect(last.byUser.find((u) => u.key === bob)).toMatchObject({
      tokens: 1200,
      costUsd: 0,
      activeMs: 0,
    });
    expect(last.byModel).toEqual([
      { key: "gpt-5.6-sol", tokens: 2400 },
      { key: "codex-auto-review", tokens: 1200 },
    ]);
    expect(r.users.map((u) => u.name)).toEqual(["Alice", "Bob"]);
    expect(r.models).toEqual(["gpt-5.6-sol", "codex-auto-review"]);
    expect(r.peak).toEqual({ bucket: "2026-08-31", total: 3600 });
    // A model with no price row must be flagged, never drawn as a real $0 (spec).
    expect(r.unpricedModels).toEqual(["codex-auto-review"]);
  });

  it("buckets by week and month, scopes to a user and handles empty ranges", async () => {
    const t = setup();
    const { alice } = await seedTeam(t);
    const weekly = await withUser(t, "alice").query(api.stats.trends, {
      from: "2026-08-24",
      to: "2026-09-06",
      bucket: "week",
    });
    expect(weekly.points.map((p) => [p.bucket, p.total])).toEqual([
      ["2026-08-24", 2400],
      ["2026-08-31", 3600],
    ]);
    const monthly = await withUser(t, "alice").query(api.stats.trends, {
      from: "2026-07-01",
      to: "2026-09-30",
      bucket: "month",
    });
    expect(monthly.points.map((p) => [p.bucket, p.total])).toEqual([
      ["2026-07-01", 0],
      ["2026-08-01", 6000],
      ["2026-09-01", 0],
    ]);
    expect(monthly.peak).toEqual({ bucket: "2026-08-01", total: 6000 });

    const mine = await withUser(t, "bob").query(api.stats.trends, {
      from: "2026-08-31",
      to: "2026-08-31",
      bucket: "day",
      userId: alice,
    });
    expect(mine.points[0]?.total).toBe(2400);
    expect(mine.points[0]?.byUser).toHaveLength(1);
    expect(mine.models).toEqual(["gpt-5.6-sol"]);
    expect(mine.unpricedModels).toEqual([]); // alice's only model is priced

    const empty = await withUser(t, "alice").query(api.stats.trends, {
      from: "2025-01-01",
      to: "2025-01-03",
      bucket: "day",
    });
    expect(empty.points.map((p) => p.total)).toEqual([0, 0, 0]);
    expect(empty.users).toEqual([]);
    expect(empty.models).toEqual([]);
    expect(empty.peak).toBeNull();
  });
});

describe("stats.breakdowns", () => {
  it("returns every breakdown sorted by size with shares and machine labels", async () => {
    const t = setup();
    const { alice } = await seedTeam(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("machines", {
        machineId: "machine-1",
        userId: alice,
        label: "brisk-otter",
        platform: "darwin",
        cliVersion: "0.1.0",
        firstSeenAt: 1,
        lastSyncAt: 1,
      });
    });
    const b = await withUser(t, "alice").query(api.stats.breakdowns, {
      from: "2026-08-30",
      to: "2026-08-31",
    });
    expect(b.totalTokens).toBe(4800);
    expect(b.byModelEffort.map((m) => [m.key, m.effort, m.tokens.total, m.share])).toEqual([
      ["gpt-5.6-sol", "medium", 3600, 0.75],
      ["codex-auto-review", null, 1200, 0.25],
    ]);
    expect(b.byModelEffort[0]?.costUsd).toBeCloseTo(0.00984, 8);
    expect(b.byModelEffort[1]?.costUsd).toBeNull();
    expect(b.byModel.map((m) => [m.key, m.effort, m.responses])).toEqual([
      ["gpt-5.6-sol", null, 3],
      ["codex-auto-review", null, 1],
    ]);
    expect(b.byEffort).toEqual([
      { key: "medium", tokens: 3600, responses: 3, share: 0.75 },
      { key: "(none)", tokens: 1200, responses: 1, share: 0.25 },
    ]);
    expect(b.toolCalls).toBe(6);
    expect(b.byTool).toHaveLength(9);
    expect(b.byTool[0]).toEqual({ key: "commandRead", count: 6, share: 1 });
    expect(b.byMcpTool).toEqual([]);
    expect(b.bySkill).toEqual([]);
    expect(b.byProject).toEqual([
      {
        key: "alpha",
        tokens: 4800,
        responses: 4,
        sessions: 1,
        userMessages: 2,
        linesAdded: 10,
        linesRemoved: 2,
        share: 1,
      },
      {
        key: "beta",
        tokens: 0,
        responses: 0,
        sessions: 1,
        userMessages: 2,
        linesAdded: 10,
        linesRemoved: 2,
        share: 0,
      },
    ]);
    // byMachine/bySource tokens are event-derived like every other breakdown, so their shares are
    // taken against the same `totalTokens` and are comparable with byProject's on the same page.
    // Sub-agent threads contribute tokens but no session count, as everywhere else.
    expect(b.byMachine).toEqual([
      { key: "machine-1", label: "brisk-otter", tokens: 3600, sessions: 2, share: 0.75 },
      { key: "machine-2", label: "machine-2", tokens: 1200, sessions: 0, share: 0.25 },
    ]);
    expect(b.bySource).toEqual([
      { key: "cli", tokens: 3600, sessions: 2, share: 0.75 },
      { key: "subagent:review", tokens: 1200, sessions: 0, share: 0.25 },
    ]);
    expect(b.byHour[9]).toBe(3600);
    expect(b.byHour[10]).toBe(1200);
    expect(b.byHour).toHaveLength(24);
  });

  it("agrees with the headline on both days of a midnight-spanning session", async () => {
    const t = setup();
    const alice = await registerUser(t, "alice");
    // A session starting 2026-08-30 23:50 and ending 00:30, whose two token events straddle
    // midnight (400 before, 600 after). Its SESSION metrics belong to the start day; its TOKENS
    // belong to each event's own day, so neither table can disagree with the card above it.
    await seedRollup(
      t,
      alice,
      "2026-08-30",
      [ev({ hour: 23, input: 300, cachedInput: 100, output: 100, reasoning: 20, total: 400 })],
      [
        ses({
          tokens: {
            input: 700,
            cachedInput: 200,
            cacheWrite: 0,
            output: 300,
            reasoning: 50,
            total: 1000,
          },
        }),
      ],
    );
    await seedRollup(
      t,
      alice,
      "2026-08-31",
      [ev({ hour: 0, input: 400, cachedInput: 100, output: 200, reasoning: 30, total: 600 })],
      [],
    );

    const first = await withUser(t, "alice").query(api.stats.breakdowns, {
      from: "2026-08-30",
      to: "2026-08-30",
    });
    expect(first.totalTokens).toBe(400);
    expect(first.byMachine[0]).toMatchObject({
      key: "machine-1",
      tokens: 400,
      sessions: 1,
      share: 1,
    });
    expect(first.bySource[0]).toMatchObject({ key: "cli", tokens: 400, sessions: 1, share: 1 });

    // The next day carries the rest of the tokens and none of the session — as byProject does.
    const second = await withUser(t, "alice").query(api.stats.breakdowns, {
      from: "2026-08-31",
      to: "2026-08-31",
    });
    expect(second.totalTokens).toBe(600);
    expect(second.byMachine[0]).toMatchObject({
      key: "machine-1",
      tokens: 600,
      sessions: 0,
      share: 1,
    });
    expect(second.byProject[0]).toMatchObject({ key: "alpha", tokens: 600, sessions: 0, share: 1 });

    for (const b of [first, second]) {
      for (const row of [...b.byMachine, ...b.bySource]) {
        expect(row.share).toBeGreaterThanOrEqual(0);
        expect(row.share).toBeLessThanOrEqual(1);
      }
      expect(b.byMachine.reduce((sum, m) => sum + m.share, 0)).toBeCloseTo(1, 10);
      expect(b.bySource.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1, 10);
      expect(b.byProject.reduce((sum, p) => sum + p.share, 0)).toBeCloseTo(1, 10);
    }
  });

  it("is empty but well-formed without data", async () => {
    const t = setup();
    await registerUser(t, "alice");
    const b = await withUser(t, "alice").query(api.stats.breakdowns, {
      from: "2025-01-01",
      to: "2025-01-01",
    });
    expect(b.totalTokens).toBe(0);
    expect(b.byModel).toEqual([]);
    expect(b.byTool.every((t) => t.count === 0 && t.share === 0)).toBe(true);
    expect(b.byHour).toEqual(new Array(24).fill(0));
  });
});

describe("stats.activityHeatmap", () => {
  it("lists only days with data for one user, with cost and maxima", async () => {
    const t = setup();
    const { alice, bob } = await seedTeam(t);
    await seedRollup(
      t,
      alice,
      "2026-08-15",
      [],
      [ses({ isSubagent: true, source: "subagent:review" })],
    );
    const r = await withUser(t, "alice").query(api.stats.activityHeatmap, {
      userId: alice,
      from: "2026-08-01",
      to: "2026-08-31",
    });
    expect(r.range).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(r.days.map((d) => [d.day, d.tokens, d.sessions])).toEqual([
      ["2026-08-29", 1200, 0],
      ["2026-08-30", 1200, 1],
      ["2026-08-31", 2400, 1],
    ]);
    expect(r.days[2]?.costUsd).toBeCloseTo(0.00656, 8);
    expect(r.activeDays).toBe(3);
    expect(r.maxTokens).toBe(2400);
    expect(r.unpricedModels).toEqual([]);

    const b = await withUser(t, "alice").query(api.stats.activityHeatmap, {
      userId: bob,
      from: "2026-08-01",
      to: "2026-08-31",
    });
    expect(b.days).toEqual([{ day: "2026-08-31", tokens: 1200, sessions: 0, costUsd: 0 }]);
    // Bob's only model has no price row: the $0 above is unpriced, not free.
    expect(b.unpricedModels).toEqual(["codex-auto-review"]);
  });
});

describe("stats.dayHourHeatmap", () => {
  it("accumulates hourly tokens per weekday (Monday = 0) and finds the peak cell", async () => {
    const t = setup();
    await seedTeam(t);
    const r = await withUser(t, "alice").query(api.stats.dayHourHeatmap, {
      from: "2026-08-29",
      to: "2026-08-31",
    });
    expect(r.grid).toHaveLength(7);
    expect(r.grid.every((row) => row.length === 24)).toBe(true);
    expect(r.grid[5]?.[9]).toBe(1200); // Saturday 2026-08-29
    expect(r.grid[6]?.[9]).toBe(1200); // Sunday 2026-08-30
    expect(r.grid[0]?.[9]).toBe(2400); // Monday 2026-08-31 (alice + bob)
    expect(r.grid[0]?.[10]).toBe(1200);
    expect(r.max).toBe(2400);
    expect(r.peakWeekday).toBe(0);
    expect(r.peakHour).toBe(9);
  });

  it("returns an all-zero grid without peaks when there is no data", async () => {
    const t = setup();
    await registerUser(t, "alice");
    const r = await withUser(t, "alice").query(api.stats.dayHourHeatmap, {
      from: "2025-01-01",
      to: "2025-01-07",
    });
    expect(r.grid.flat().every((v) => v === 0)).toBe(true);
    expect(r).toMatchObject({ max: 0, peakHour: null, peakWeekday: null });
  });

  it("reports how many machine timezones the grid mixes", async () => {
    // Each machine stamps its own hour buckets in its own zone, and this grid sums them all into
    // one 7x24. For one zone that is a real wall-clock hour; across zones "Peak hour" is an
    // average of different clocks and cannot be re-projected here, because the hour bucket has
    // already lost its offset by the time it reaches the server. The count is what lets the UI
    // say so instead of presenting a fiction.
    const t = setup();
    await seedTeam(t);
    const args = { from: "2026-08-29", to: "2026-08-31" };
    expect((await withUser(t, "alice").query(api.stats.dayHourHeatmap, args)).zones).toBe(0);
    await t.run(async (ctx) => {
      const base = {
        userId: (await ctx.db.query("users").first())!._id,
        platform: "darwin",
        cliVersion: "0.1.0",
        firstSeenAt: 1,
        lastSyncAt: 1,
      };
      await ctx.db.insert("machines", {
        ...base,
        machineId: "machine-1",
        label: "one",
        tz: "Europe/London",
      });
      await ctx.db.insert("machines", {
        ...base,
        machineId: "machine-2",
        label: "two",
        tz: "Asia/Tokyo",
      });
      // Not a contributor to these rollups, so its zone must not inflate the count.
      await ctx.db.insert("machines", {
        ...base,
        machineId: "machine-elsewhere",
        label: "three",
        tz: "America/Denver",
      });
    });
    expect((await withUser(t, "alice").query(api.stats.dayHourHeatmap, args)).zones).toBe(2);
  });
});

describe("stats.quota", () => {
  it("returns null without snapshots and otherwise the freshest reading", async () => {
    const t = setup();
    const alice = await registerUser(t, "alice");
    const bob = await registerUser(t, "bob");
    expect(await withUser(t, "alice").query(api.stats.quota, {})).toBeNull();
    await t.run(async (ctx) => {
      await ctx.db.insert("machines", {
        machineId: "machine-1",
        userId: alice,
        label: "brisk-otter",
        platform: "darwin",
        cliVersion: "0.1.0",
        firstSeenAt: 1,
        lastSyncAt: 100,
        lastRateLimit: {
          observedAt: 90,
          usedPercent: 10,
          windowMinutes: 10080,
          resetsAt: 1000,
          planType: "team",
          receivedAt: 100,
        },
      });
      await ctx.db.insert("machines", {
        machineId: "machine-2",
        userId: bob,
        label: "calm-heron",
        platform: "linux",
        cliVersion: "0.1.0",
        firstSeenAt: 1,
        lastSyncAt: 200,
        lastRateLimit: { observedAt: 80, usedPercent: 55, windowMinutes: 10080, receivedAt: 200 },
      });
      await ctx.db.insert("machines", {
        machineId: "machine-3",
        userId: bob,
        label: "no-snapshot",
        platform: "win32",
        cliVersion: "0.1.0",
        firstSeenAt: 1,
        lastSyncAt: 300,
      });
    });
    // machine-2 synced later (receivedAt 200 vs 100) but is carrying an OLDER reading
    // (observedAt 80 vs 90) — a machine that was offline and caught up. Ranking on arrival time
    // showed that stale 55% and let the gauge walk backwards past machine-1's fresher 10%.
    expect(await withUser(t, "alice").query(api.stats.quota, {})).toEqual({
      usedPercent: 10,
      windowMinutes: 10080,
      resetsAt: 1000,
      planType: "team",
      limitId: null,
      observedAt: 90,
      receivedAt: 100,
      machine: { machineId: "machine-1", label: "brisk-otter" },
      user: { userId: alice, name: "Alice", imageUrl: null },
    });
  });

  it("does not let a machine with a fast clock pin the gauge to its own reading", async () => {
    // Why the ranking key is `min(observedAt, receivedAt)` and not `observedAt`: observedAt is the
    // reporting machine's own clock, which the codebase already documents twice as untrustworthy
    // (see quota-card.tsx). A fast RTC claiming to have observed the quota in 2030 would otherwise
    // outrank every honest machine forever. Clamping to the server's own receipt time bounds the
    // damage to "it synced most recently", which is true and harmless.
    const t = setup();
    const alice = await registerUser(t, "alice");
    await registerUser(t, "bob");
    await t.run(async (ctx) => {
      await ctx.db.insert("machines", {
        machineId: "honest",
        userId: alice,
        label: "brisk-otter",
        platform: "darwin",
        cliVersion: "0.1.0",
        firstSeenAt: 1,
        lastSyncAt: 5_000,
        lastRateLimit: {
          observedAt: 4_900,
          usedPercent: 42,
          windowMinutes: 10080,
          receivedAt: 5_000,
        },
      });
      await ctx.db.insert("machines", {
        machineId: "fast-clock",
        userId: alice,
        label: "wrong-rtc",
        platform: "linux",
        cliVersion: "0.1.0",
        firstSeenAt: 1,
        lastSyncAt: 1_000,
        // Claims an observation far in the future, but the server saw it long ago.
        lastRateLimit: {
          observedAt: 99_999_999,
          usedPercent: 3,
          windowMinutes: 10080,
          receivedAt: 1_000,
        },
      });
    });
    const q = await withUser(t, "alice").query(api.stats.quota, {});
    expect(q?.machine.machineId).toBe("honest");
    expect(q?.usedPercent).toBe(42);
  });
});

describe("stats.quotaHistory", () => {
  it("returns readings since the given time, oldest first, labelled by machine", async () => {
    const t = setup();
    const alice = await registerUser(t, "alice");
    const bob = await registerUser(t, "bob");
    await t.run(async (ctx) => {
      await ctx.db.insert("machines", {
        machineId: "machine-1",
        userId: alice,
        label: "brisk-otter",
        platform: "darwin",
        cliVersion: "0.1.0",
        firstSeenAt: 1,
        lastSyncAt: 1,
      });
      const rows = [
        { machineId: "machine-1", userId: alice, observedAt: 1_000, receivedAt: 1_100, used: 5 },
        { machineId: "machine-2", userId: bob, observedAt: 2_000, receivedAt: 2_100, used: 15 },
        // Fast clock: observed "later" than received. `t` clamps to the server receive time.
        { machineId: "machine-1", userId: alice, observedAt: 9_000, receivedAt: 3_100, used: 30 },
        { machineId: "machine-1", userId: alice, observedAt: 500, receivedAt: 600, used: 1 },
      ];
      for (const r of rows) {
        await ctx.db.insert("quotaSnapshots", {
          machineId: r.machineId,
          userId: r.userId,
          observedAt: r.observedAt,
          receivedAt: r.receivedAt,
          usedPercent: r.used,
          windowMinutes: 10080,
        });
      }
    });
    const result = await withUser(t, "alice").query(api.stats.quotaHistory, { sinceMs: 1_000 });
    expect(result.truncated).toBe(false);
    expect(result.sinceMs).toBe(1_000);
    expect(result.points).toEqual([
      { t: 1_000, usedPercent: 5, resetsAt: null, machineId: "machine-1", label: "brisk-otter" },
      { t: 2_000, usedPercent: 15, resetsAt: null, machineId: "machine-2", label: "machine-2" },
      { t: 3_100, usedPercent: 30, resetsAt: null, machineId: "machine-1", label: "brisk-otter" },
    ]);
    // `untilMs` bounds the window from above too, and the window never exceeds the server cap.
    const bounded = await withUser(t, "alice").query(api.stats.quotaHistory, {
      sinceMs: 0,
      untilMs: 2_500,
    });
    expect(bounded.points.map((p) => p.usedPercent)).toEqual([1, 5, 15]);
    await expect(t.query(api.stats.quotaHistory, { sinceMs: 0 })).rejects.toMatchObject({
      data: { code: "unauthenticated" },
    });
  });
});

describe("stats.bounds", () => {
  it("returns the first and last rollup day for the team or one user", async () => {
    const t = setup();
    const { bob } = await seedTeam(t);
    expect(await withUser(t, "alice").query(api.stats.bounds, {})).toEqual({
      firstDay: "2026-08-29",
      lastDay: "2026-08-31",
    });
    expect(await withUser(t, "alice").query(api.stats.bounds, { userId: bob })).toEqual({
      firstDay: "2026-08-31",
      lastDay: "2026-08-31",
    });
  });

  it("returns nulls without data", async () => {
    const t = setup();
    await registerUser(t, "alice");
    expect(await withUser(t, "alice").query(api.stats.bounds, {})).toEqual({
      firstDay: null,
      lastDay: null,
    });
  });
});
