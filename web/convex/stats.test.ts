import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { EventInput, SessionInput } from "./lib/aggregate";
import { withUser, registerUser, seedRollup, setup, ZERO_TOOLS, type Harness } from "./test.helpers";

const ev = (o: Partial<EventInput> = {}): EventInput => ({
  hour: 9, model: "gpt-5.6-sol", effort: "medium", project: "alpha", isSubagent: false,
  input: 1000, cachedInput: 400, cacheWrite: 0, output: 200, reasoning: 50, total: 1200,
  ...o,
});
const ses = (o: Partial<SessionInput> = {}): SessionInput => ({
  machineId: "machine-1", project: "alpha", source: "cli", isSubagent: false,
  turns: 2, userMessages: 2, agentMessages: 2, linesAdded: 10, linesRemoved: 2, filesChanged: 1,
  compactions: 0, activeMs: 600_000, wallMs: 3_600_000,
  ttft: { count: 2, sumMs: 1500, hist: [0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  toolCounts: { ...ZERO_TOOLS, commandRead: 3 }, mcpTools: [], skills: [],
  tokens: { input: 1000, cachedInput: 400, cacheWrite: 0, output: 200, reasoning: 50, total: 1200 },
  ...o,
});

async function seedPrices(t: Harness) {
  await t.run(async (ctx) => {
    await ctx.db.insert("modelPrices", {
      model: "gpt-5.6-sol", inputUsdPerMTok: 2, cachedInputUsdPerMTok: 0.2, outputUsdPerMTok: 10,
      source: "seed", updatedAt: 1,
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
    t, bob, "2026-08-31",
    [ev({ model: "codex-auto-review", effort: undefined, isSubagent: true })],
    [ses({ isSubagent: true, source: "subagent:review", machineId: "machine-2" })],
  );
  return { alice, bob };
}

describe("stats.summary", () => {
  it("folds the team's rollups and compares with the previous period", async () => {
    const t = setup();
    await seedTeam(t);
    const s = await withUser(t, "alice").query(api.stats.summary, { from: "2026-08-30", to: "2026-08-31" });
    expect(s.range).toEqual({ from: "2026-08-30", to: "2026-08-31" });
    expect(s.previousRange).toEqual({ from: "2026-08-28", to: "2026-08-29" });
    expect(s.tokens).toEqual({ input: 4000, cachedInput: 1600, cacheWrite: 0, output: 800, reasoning: 200, total: 4800 });
    expect(s.previousTokens?.total).toBe(1200);
    expect(s.metrics.totalTokens).toEqual({ current: 4800, previous: 1200, change: 3 });
    expect(s.metrics.sessions).toEqual({ current: 2, previous: 0, change: null });
    expect(s.metrics.subagentTokens.current).toBe(1200);
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
  });

  it("scopes to one user and can skip the previous period", async () => {
    const t = setup();
    const { alice } = await seedTeam(t);
    const mine = await withUser(t, "bob").query(api.stats.summary, { from: "2026-08-30", to: "2026-08-31", userId: alice });
    expect(mine.metrics.totalTokens).toEqual({ current: 3600, previous: 1200, change: 2 });
    expect(mine.metrics.sessions.current).toBe(2);
    expect(mine.unpricedModels).toEqual([]);

    const all = await withUser(t, "alice").query(api.stats.summary, { from: "2026-08-30", to: "2026-08-31", previous: false });
    expect(all.previousRange).toBeNull();
    expect(all.previousTokens).toBeNull();
    expect(all.metrics.totalTokens).toEqual({ current: 4800, previous: null, change: null });
  });

  it("returns zeros for an empty range and rejects bad ranges and anonymous callers", async () => {
    const t = setup();
    await seedTeam(t);
    const empty = await withUser(t, "alice").query(api.stats.summary, { from: "2025-01-01", to: "2025-01-07" });
    expect(empty.metrics.totalTokens).toEqual({ current: 0, previous: 0, change: null });
    expect(empty.metrics.cacheHitRate).toEqual({ current: 0, previous: null, change: null });
    await expect(
      withUser(t, "alice").query(api.stats.summary, { from: "2026-08-31", to: "2026-08-30" }),
    ).rejects.toMatchObject({ data: { code: "bad_range" } });
    await expect(t.query(api.stats.summary, { from: "2026-08-30", to: "2026-08-31" })).rejects.toMatchObject({
      data: { code: "unauthenticated" },
    });
  });
});

describe("stats.leaderboard", () => {
  it("ranks users by tokens with previous-period ranks and null for newcomers", async () => {
    const t = setup();
    const { alice, bob } = await seedTeam(t);
    const board = await withUser(t, "alice").query(api.stats.leaderboard, { from: "2026-08-30", to: "2026-08-31" });
    expect(board.previousRange).toEqual({ from: "2026-08-28", to: "2026-08-29" });
    expect(board.rows).toHaveLength(2);
    expect(board.rows[0]).toMatchObject({
      userId: alice, name: "Alice", imageUrl: null, rank: 1, previousRank: 1, previousTokens: 1200, change: 2,
      sessions: 2, turns: 4, messages: 8, userMessages: 4, linesAdded: 20, linesRemoved: 4,
      tokensPerLine: 180, cacheHitRate: 0.4, activeMs: 1_200_000, unpriced: false,
    });
    expect(board.rows[0]?.tokens.total).toBe(3600);
    expect(board.rows[0]?.costUsd).toBeCloseTo(0.00984, 8);
    expect(board.rows[1]).toMatchObject({
      userId: bob, name: "Bob", rank: 2, previousRank: null, previousTokens: null, change: null,
      sessions: 0, costUsd: 0, unpriced: true, tokensPerLine: null,
    });
    expect(board.rows[1]?.tokens.total).toBe(1200);
  });

  it("breaks ties by name and omits previous ranks when previous is false", async () => {
    const t = setup();
    const alice = await registerUser(t, "alice");
    const bob = await registerUser(t, "bob");
    await seedRollup(t, bob, "2026-08-31", [ev()], []);
    await seedRollup(t, alice, "2026-08-31", [ev()], []);
    const board = await withUser(t, "alice").query(api.stats.leaderboard, { from: "2026-08-31", to: "2026-08-31", previous: false });
    expect(board.previousRange).toBeNull();
    expect(board.rows.map((r) => [r.name, r.rank, r.previousRank])).toEqual([["Alice", 1, null], ["Bob", 2, null]]);
    expect(await withUser(t, "alice").query(api.stats.leaderboard, { from: "2025-01-01", to: "2025-01-01" })).toMatchObject({ rows: [] });
  });
});

describe("stats.trends", () => {
  it("zero-fills daily buckets and reports per-user, per-model series and the peak", async () => {
    const t = setup();
    const { alice, bob } = await seedTeam(t);
    const r = await withUser(t, "alice").query(api.stats.trends, { from: "2026-08-29", to: "2026-08-31", bucket: "day" });
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
    expect(last.byUser.find((u) => u.key === alice)).toMatchObject({ tokens: 2400, activeMs: 600_000 });
    expect(last.byUser.find((u) => u.key === bob)).toMatchObject({ tokens: 1200, costUsd: 0, activeMs: 0 });
    expect(last.byModel).toEqual([
      { key: "gpt-5.6-sol", tokens: 2400 },
      { key: "codex-auto-review", tokens: 1200 },
    ]);
    expect(r.users.map((u) => u.name)).toEqual(["Alice", "Bob"]);
    expect(r.models).toEqual(["gpt-5.6-sol", "codex-auto-review"]);
    expect(r.peak).toEqual({ bucket: "2026-08-31", total: 3600 });
  });

  it("buckets by week and month, scopes to a user and handles empty ranges", async () => {
    const t = setup();
    const { alice } = await seedTeam(t);
    const weekly = await withUser(t, "alice").query(api.stats.trends, { from: "2026-08-24", to: "2026-09-06", bucket: "week" });
    expect(weekly.points.map((p) => [p.bucket, p.total])).toEqual([
      ["2026-08-24", 2400],
      ["2026-08-31", 3600],
    ]);
    const monthly = await withUser(t, "alice").query(api.stats.trends, { from: "2026-07-01", to: "2026-09-30", bucket: "month" });
    expect(monthly.points.map((p) => [p.bucket, p.total])).toEqual([
      ["2026-07-01", 0],
      ["2026-08-01", 6000],
      ["2026-09-01", 0],
    ]);
    expect(monthly.peak).toEqual({ bucket: "2026-08-01", total: 6000 });

    const mine = await withUser(t, "bob").query(api.stats.trends, { from: "2026-08-31", to: "2026-08-31", bucket: "day", userId: alice });
    expect(mine.points[0]?.total).toBe(2400);
    expect(mine.points[0]?.byUser).toHaveLength(1);
    expect(mine.models).toEqual(["gpt-5.6-sol"]);

    const empty = await withUser(t, "alice").query(api.stats.trends, { from: "2025-01-01", to: "2025-01-03", bucket: "day" });
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
        machineId: "machine-1", userId: alice, label: "brisk-otter", platform: "darwin",
        cliVersion: "0.1.0", firstSeenAt: 1, lastSyncAt: 1,
      });
    });
    const b = await withUser(t, "alice").query(api.stats.breakdowns, { from: "2026-08-30", to: "2026-08-31" });
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
      { key: "alpha", tokens: 4800, responses: 4, sessions: 1, userMessages: 2, linesAdded: 10, linesRemoved: 2, share: 1 },
      { key: "beta", tokens: 0, responses: 0, sessions: 1, userMessages: 2, linesAdded: 10, linesRemoved: 2, share: 0 },
    ]);
    expect(b.byMachine).toEqual([
      { key: "machine-1", label: "brisk-otter", tokens: 2400, sessions: 2, share: 0.5 },
      { key: "machine-2", label: "machine-2", tokens: 1200, sessions: 1, share: 0.25 },
    ]);
    expect(b.bySource).toEqual([
      { key: "cli", tokens: 2400, sessions: 2, share: 0.5 },
      { key: "subagent:review", tokens: 1200, sessions: 1, share: 0.25 },
    ]);
    expect(b.byHour[9]).toBe(3600);
    expect(b.byHour[10]).toBe(1200);
    expect(b.byHour).toHaveLength(24);
  });

  it("is empty but well-formed without data", async () => {
    const t = setup();
    await registerUser(t, "alice");
    const b = await withUser(t, "alice").query(api.stats.breakdowns, { from: "2025-01-01", to: "2025-01-01" });
    expect(b.totalTokens).toBe(0);
    expect(b.byModel).toEqual([]);
    expect(b.byTool.every((t) => t.count === 0 && t.share === 0)).toBe(true);
    expect(b.byHour).toEqual(new Array(24).fill(0));
  });
});
