import { describe, expect, it } from "vitest";
import { QUOTA_STALE_MS } from "../../shared/src/constants";
import { SummaryResponse } from "../../shared/src/summary";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { EventInput, SessionInput } from "./lib/aggregate";
import {
  makeMachine,
  registerUser,
  seedRollup,
  setup,
  T0,
  userWithToken,
  withUser,
  ZERO_TOOLS,
  type Harness,
} from "./test.helpers";

/** The day `T0` (2026-08-31) falls on, used as the card's `today` throughout. */
const TODAY = "2026-08-31";

function tokens(total: number) {
  const output = Math.round(total / 6);
  return {
    input: total - output,
    cachedInput: Math.round((total - output) / 2),
    cacheWrite: 0,
    output,
    reasoning: 0,
    total,
  };
}

function event(total: number, model = "gpt-5.6-sol"): EventInput {
  return {
    hour: 9,
    model,
    project: "project-a",
    source: "cli",
    isSubagent: false,
    machineId: "machine-1",
    ...tokens(total),
  };
}

/** One session's worth of shape; only the `sessions` count matters to the card. */
function session(): SessionInput {
  return {
    machineId: "machine-1",
    project: "project-a",
    source: "cli",
    isSubagent: false,
    turns: 1,
    userMessages: 1,
    agentMessages: 1,
    linesAdded: 1,
    linesRemoved: 0,
    filesChanged: 1,
    compactions: 0,
    activeMs: 30_000,
    wallMs: 60_000,
    ttft: { count: 0, sumMs: 0, hist: new Array<number>(16).fill(0) },
    toolCounts: ZERO_TOOLS,
    mcpTools: [],
    skills: [],
    tokens: tokens(600),
  };
}

async function getSummary(t: Harness, raw: string | null, query = `?today=${TODAY}`) {
  const headers: Record<string, string> = {};
  if (raw !== null) headers.authorization = `Bearer ${raw}`;
  const response = await t.fetch(`/api/v1/summary${query}`, { headers });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json: any = await response.json();
  return { status: response.status, json };
}

/** A price row for the seeded model, so `costUsd` is a real number rather than a silent 0. */
async function seedPrice(t: Harness, model = "gpt-5.6-sol") {
  await t.run(async (ctx) =>
    ctx.db.insert("modelPrices", {
      model,
      inputUsdPerMTok: 1,
      cachedInputUsdPerMTok: 0.1,
      outputUsdPerMTok: 10,
      source: "test",
      updatedAt: T0,
    }),
  );
}

describe("GET /api/v1/summary authentication", () => {
  it("rejects missing, unknown and revoked tokens", async () => {
    const t = setup();
    const alice = await userWithToken(t, "alice");

    expect((await getSummary(t, null)).status).toBe(401);

    const unknown = await getSummary(t, "ck_nope");
    expect(unknown.status).toBe(401);
    expect(unknown.json.error).toBe("unauthorized");

    await withUser(t, "alice").mutation(api.syncTokens.revoke, { tokenId: alice.tokenId });
    const revoked = await getSummary(t, alice.raw);
    expect(revoked.status).toBe(401);
    expect(revoked.json.error).toBe("token_revoked");
  });

  it("marks the token used", async () => {
    const t = setup();
    const { raw, tokenId } = await userWithToken(t, "alice");
    await getSummary(t, raw);
    const token = await t.run(async (ctx) => ctx.db.get(tokenId));
    expect(token?.lastUsedAt).toEqual(expect.any(Number));
  });
});

describe("GET /api/v1/summary ranges", () => {
  it("splits the four tabs on the client's calendar day", async () => {
    const t = setup();
    const { userId, raw } = await userWithToken(t, "alice");
    await seedPrice(t);
    // today, 3 days back (in the week), 20 days back (in the month), 200 days back (all only).
    await seedRollup(t, userId, TODAY, [event(600)], [session()]);
    await seedRollup(t, userId, "2026-08-28", [event(300)], []);
    await seedRollup(t, userId, "2026-08-11", [event(120)], []);
    await seedRollup(t, userId, "2026-02-12", [event(60)], []);

    const { status, json } = await getSummary(t, raw);
    expect(status).toBe(200);
    expect(SummaryResponse.safeParse(json).success).toBe(true);

    expect(json.today).toBe(TODAY);
    expect(json.user).toEqual({ userId, name: "Alice" });

    expect(json.ranges.day.range).toEqual({ from: TODAY, to: TODAY });
    expect(json.ranges.day.tokens.total).toBe(600);
    expect(json.ranges.day.sessions).toBe(1);

    expect(json.ranges.week.range).toEqual({ from: "2026-08-25", to: TODAY });
    expect(json.ranges.week.tokens.total).toBe(900);

    expect(json.ranges.month.range).toEqual({ from: "2026-08-02", to: TODAY });
    expect(json.ranges.month.tokens.total).toBe(1020);

    // `all` reaches back to the oldest rollup and has no period to compare against.
    expect(json.ranges.all.range).toEqual({ from: "2026-02-12", to: TODAY });
    expect(json.ranges.all.tokens.total).toBe(1080);
    expect(json.ranges.all.previousRange).toBeNull();
    expect(json.ranges.all.changePercent).toBeNull();

    expect(json.ranges.day.topModel).toBe("gpt-5.6-sol");
    expect(json.ranges.day.costUsd).toBeGreaterThan(0);
    expect(json.ranges.day.unpricedModels).toEqual([]);
  });

  it("defaults `today` to the server's UTC day", async () => {
    const t = setup();
    const { raw } = await userWithToken(t, "alice");
    const { json } = await getSummary(t, raw, "");
    const utcToday = new Date().toISOString().slice(0, 10);
    expect(json.today).toBe(utcToday);
    expect(json.ranges.day.range).toEqual({ from: utcToday, to: utcToday });
  });

  it("rejects a `today` that is not a calendar day", async () => {
    const t = setup();
    const { raw } = await userWithToken(t, "alice");
    const bad = await getSummary(t, raw, "?today=2026-02-30");
    expect(bad.status).toBe(400);
    expect(bad.json).toMatchObject({ ok: false, error: "invalid_request" });
    expect((await getSummary(t, raw, "?today=yesterday")).status).toBe(400);
  });

  it("computes the change against the immediately preceding period", async () => {
    const t = setup();
    const { userId, raw } = await userWithToken(t, "alice");
    await seedRollup(t, userId, TODAY, [event(300)], []);
    await seedRollup(t, userId, "2026-08-30", [event(600)], []);

    const { json } = await getSummary(t, raw);
    expect(json.ranges.day.previousRange).toEqual({ from: "2026-08-30", to: "2026-08-30" });
    expect(json.ranges.day.changePercent).toBeCloseTo(-0.5, 10);
    // Both days sit inside the week, so the week has nothing before it to compare against.
    expect(json.ranges.week.changePercent).toBeNull();
  });

  it("returns zeros, not an error, when the user has no data at all", async () => {
    const t = setup();
    const { raw } = await userWithToken(t, "alice");
    const { status, json } = await getSummary(t, raw);
    expect(status).toBe(200);
    expect(SummaryResponse.safeParse(json).success).toBe(true);
    for (const key of ["day", "week", "month", "all"] as const) {
      expect(json.ranges[key].tokens.total).toBe(0);
      expect(json.ranges[key].sessions).toBe(0);
      expect(json.ranges[key].costUsd).toBe(0);
      expect(json.ranges[key].changePercent).toBeNull();
      expect(json.ranges[key].topModel).toBeNull();
    }
    expect(json.ranges.all.range).toEqual({ from: TODAY, to: TODAY });
  });

  it("shows only the token owner's numbers", async () => {
    const t = setup();
    const alice = await userWithToken(t, "alice");
    const bobId = await registerUser(t, "bob");
    await seedRollup(t, alice.userId, TODAY, [event(100)], []);
    await seedRollup(t, bobId, TODAY, [event(900)], []);

    const { json } = await getSummary(t, alice.raw);
    expect(json.ranges.day.tokens.total).toBe(100);
    expect(json.ranges.all.tokens.total).toBe(100);
  });

  it("names the models whose cost is missing rather than reporting a silent $0", async () => {
    const t = setup();
    const { userId, raw } = await userWithToken(t, "alice");
    await seedPrice(t);
    await seedRollup(t, userId, TODAY, [event(600), event(600, "codex-auto-review")], []);

    const { json } = await getSummary(t, raw);
    expect(json.ranges.day.unpricedModels).toEqual(["codex-auto-review"]);
    expect(json.ranges.day.tokens.total).toBe(1200);
    expect(json.ranges.day.costUsd).toBeGreaterThan(0);
  });
});

describe("GET /api/v1/summary quota", () => {
  async function seedMachine(
    t: Harness,
    userId: Id<"users">,
    machineId: string,
    lastRateLimit: {
      usedPercent: number;
      windowMinutes: number;
      observedAt: number;
      receivedAt: number;
      resetsAt?: number;
      planType?: string;
    },
  ) {
    const info = makeMachine({ machineId, label: machineId });
    await t.run(async (ctx) =>
      ctx.db.insert("machines", {
        machineId: info.machineId,
        userId,
        label: info.label,
        platform: info.platform,
        cliVersion: "0.1.0-test",
        firstSeenAt: T0,
        lastSyncAt: T0,
        lastRateLimit,
      }),
    );
  }

  it("reports `none` when no machine has ever sent a reading", async () => {
    const t = setup();
    const { raw } = await userWithToken(t, "alice");
    const { json } = await getSummary(t, raw);
    expect(json.quota).toMatchObject({ value: null, source: "none", stale: false });
  });

  it("returns the account-wide reading the server received most recently", async () => {
    const t = setup();
    const alice = await userWithToken(t, "alice");
    const bobId = await registerUser(t, "bob");
    const now = Date.now();
    // Bob's machine reported later by the server's clock, even though Alice's machine claims a
    // newer `observedAt` — a fast RTC must not pin the shared gauge.
    await seedMachine(t, alice.userId, "machine-a", {
      usedPercent: 90,
      windowMinutes: 10_080,
      observedAt: now + 86_400_000,
      receivedAt: now - 120_000,
    });
    await seedMachine(t, bobId, "machine-b", {
      usedPercent: 7,
      windowMinutes: 10_080,
      observedAt: now - 60_000,
      receivedAt: now - 60_000,
      resetsAt: now + 5 * 86_400_000,
      planType: "prolite",
    });

    const { json } = await getSummary(t, alice.raw);
    expect(json.quota.source).toBe("server");
    expect(json.quota.stale).toBe(false);
    expect(json.quota.value).toMatchObject({
      usedPercent: 7,
      windowMinutes: 10_080,
      planType: "prolite",
      machine: { machineId: "machine-b", label: "machine-b" },
    });
  });

  it("marks a reading older than QUOTA_STALE_MS stale but still returns it", async () => {
    const t = setup();
    const { userId, raw } = await userWithToken(t, "alice");
    const stale = Date.now() - QUOTA_STALE_MS - 60_000;
    await seedMachine(t, userId, "machine-a", {
      usedPercent: 42,
      windowMinutes: 300,
      observedAt: stale,
      receivedAt: stale,
    });

    const { json } = await getSummary(t, raw);
    expect(json.quota.source).toBe("server");
    expect(json.quota.stale).toBe(true);
    expect(json.quota.value.usedPercent).toBe(42);
  });
});
