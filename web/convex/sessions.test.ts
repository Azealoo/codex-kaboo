import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { withUser, makeSession, registerUser, setup, T0, type Harness } from "./test.helpers";

async function seed(t: Harness): Promise<{ alice: Id<"users">; bob: Id<"users"> }> {
  const alice = await registerUser(t, "alice");
  const bob = await registerUser(t, "bob");
  await t.run(async (ctx) => {
    await ctx.db.insert("modelPrices", {
      model: "gpt-5.6-sol",
      inputUsdPerMTok: 2,
      cachedInputUsdPerMTok: 0.2,
      outputUsdPerMTok: 10,
      source: "seed",
      updatedAt: 1,
    });
    await ctx.db.insert("machines", {
      machineId: "machine-1",
      userId: alice,
      label: "brisk-otter",
      platform: "darwin",
      cliVersion: "0.1.0",
      firstSeenAt: 1,
      lastSyncAt: 1,
    });
    await ctx.db.insert("sessions", {
      ...makeSession({ sessionId: "s1", gitBranch: "main" }),
      userId: alice,
      machineId: "machine-1",
      syncedAt: T0,
    });
    const s2 = makeSession({ sessionId: "s2", startedAt: T0 + 1000, model: "codex-auto-review" });
    delete s2.effort;
    await ctx.db.insert("sessions", { ...s2, userId: alice, machineId: "machine-1", syncedAt: T0 });
    await ctx.db.insert("sessions", {
      ...makeSession({ sessionId: "s3", startedAt: T0 + 2000 }),
      userId: bob,
      machineId: "machine-2",
      syncedAt: T0,
    });
  });
  return { alice, bob };
}

describe("sessions.listRecent", () => {
  it("pages newest-first across the team and joins names, labels and cost", async () => {
    const t = setup();
    const { alice, bob } = await seed(t);
    const first = await withUser(t, "alice").query(api.sessions.listRecent, {
      paginationOpts: { cursor: null, numItems: 2 },
    });
    expect(first.page.map((s) => s.sessionId)).toEqual(["s3", "s2"]);
    expect(first.isDone).toBe(false);
    expect(first.page[0]).toMatchObject({
      userId: bob,
      userName: "Bob",
      machineId: "machine-2",
      machineLabel: "machine-2",
    });
    expect(first.page[1]).toMatchObject({
      model: "codex-auto-review",
      effort: null,
      costUsd: null,
    });

    const second = await withUser(t, "alice").query(api.sessions.listRecent, {
      paginationOpts: { cursor: first.continueCursor, numItems: 2 },
    });
    expect(second.page.map((s) => s.sessionId)).toEqual(["s1"]);
    expect(second.isDone).toBe(true);
    const s1 = second.page[0]!;
    expect(s1).toMatchObject({
      userId: alice,
      userName: "Alice",
      machineLabel: "brisk-otter",
      gitBranch: "main",
      model: "gpt-5.6-sol",
      effort: "medium",
      source: "cli",
      isSubagent: false,
      turns: 2,
      userMessages: 2,
      agentMessages: 2,
      cacheHitRate: 0.4,
      activeMs: 600_000,
      linesAdded: 10,
      linesRemoved: 2,
      inProgress: false,
      day: "2026-08-31",
    });
    expect(s1.costUsd).toBeCloseTo(0.00328, 8);
    expect(s1.toolCounts.commandRead).toBe(3);
  });

  it("scopes to one user", async () => {
    const t = setup();
    const { alice } = await seed(t);
    const mine = await withUser(t, "bob").query(api.sessions.listRecent, {
      userId: alice,
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(mine.page.map((s) => s.sessionId)).toEqual(["s2", "s1"]);
    expect(mine.isDone).toBe(true);
  });
});

describe("sessions.get", () => {
  it("returns one session row or null", async () => {
    const t = setup();
    await seed(t);
    const row = await withUser(t, "alice").query(api.sessions.get, { sessionId: "s2" });
    expect(row).toMatchObject({ sessionId: "s2", userName: "Alice", costUsd: null });
    expect(await withUser(t, "alice").query(api.sessions.get, { sessionId: "nope" })).toBeNull();
    await expect(t.query(api.sessions.get, { sessionId: "s2" })).rejects.toMatchObject({
      data: { code: "unauthenticated" },
    });
  });
});
