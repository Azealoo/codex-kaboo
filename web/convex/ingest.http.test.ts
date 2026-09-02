import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_BODY_BYTES } from "../../shared/src/constants";
import { api } from "./_generated/api";
import {
  withUser,
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

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/v1/health", () => {
  it("answers without auth", async () => {
    const t = setup();
    const res = await t.fetch("/api/v1/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, serverTime: expect.any(Number) });
  });
});

describe("authentication", () => {
  it("rejects missing, unknown and revoked tokens", async () => {
    const t = setup();
    const alice = await userWithToken(t, "alice");

    const missing = await postSync(t, null, makeBatch());
    expect(missing.status).toBe(401);
    expect(missing.json).toEqual({ ok: false, error: "unauthorized", message: expect.any(String) });

    const unknown = await postSync(t, "ck_nope", makeBatch());
    expect(unknown.status).toBe(401);
    expect(unknown.json.error).toBe("unauthorized");

    const whoamiUnknown = await t.fetch("/api/v1/whoami", { headers: { authorization: "Basic abc" } });
    expect(whoamiUnknown.status).toBe(401);

    await withUser(t, "alice").mutation(api.syncTokens.revoke, { tokenId: alice.tokenId });
    const revoked = await postSync(t, alice.raw, makeBatch());
    expect(revoked.status).toBe(401);
    expect(revoked.json.error).toBe("token_revoked");
    const whoamiRevoked = await t.fetch("/api/v1/whoami", {
      headers: { authorization: `Bearer ${alice.raw}` },
    });
    expect(whoamiRevoked.status).toBe(401);
    expect((await whoamiRevoked.json()).error).toBe("token_revoked");
  });
});

describe("GET /api/v1/whoami", () => {
  it("returns the token owner and marks the token used", async () => {
    const t = setup();
    const { userId, raw, tokenId } = await userWithToken(t, "alice");
    const res = await t.fetch("/api/v1/whoami", { headers: { authorization: `Bearer ${raw}` } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      userId,
      name: "Alice",
      email: "alice@example.com",
      token: { name: "test", prefix: "ck_alice0" },
      serverTime: expect.any(Number),
    });
    const token = await t.run(async (ctx) => ctx.db.get(tokenId));
    expect(token?.lastUsedAt).toEqual(expect.any(Number));
  });
});

describe("POST /api/v1/sync validation", () => {
  it("rejects bodies over 8 MiB with the limits", async () => {
    const t = setup();
    const { raw } = await userWithToken(t, "alice");
    const res = await postSync(t, raw, JSON.stringify({ pad: "x".repeat(MAX_BODY_BYTES) }));
    expect(res.status).toBe(413);
    expect(res.json).toMatchObject({
      ok: false,
      error: "payload_too_large",
      limits: { maxBodyBytes: MAX_BODY_BYTES, maxSessions: 500, maxEvents: 5000 },
    });
  });

  it("rejects more than 5,000 events with too_many_items", async () => {
    const t = setup();
    const { raw } = await userWithToken(t, "alice");
    const tokenEvents = Array.from({ length: 5001 }, (_, i) => makeEvent({ sessionId: "s", seq: i }));
    const res = await postSync(t, raw, makeBatch({ tokenEvents }));
    expect(res.status).toBe(413);
    expect(res.json).toMatchObject({ ok: false, error: "too_many_items", limits: { maxEvents: 5000 } });
  });

  it("rejects malformed JSON", async () => {
    const t = setup();
    const { raw } = await userWithToken(t, "alice");
    const res = await postSync(t, raw, "{not json");
    expect(res.status).toBe(400);
    expect(res.json).toEqual({ ok: false, error: "invalid_json", message: expect.any(String) });
  });

  it("rejects batches that fail the shared schema and lists the issues", async () => {
    const t = setup();
    const { raw } = await userWithToken(t, "alice");
    const bad = {
      ...makeBatch({ tokenEvents: [makeEvent({ sessionId: "s", seq: 0, hour: 24 })] }),
      schemaVersion: 2,
    };
    const res = await postSync(t, raw, bad);
    expect(res.status).toBe(400);
    expect(res.json.error).toBe("invalid_batch");
    const paths = (res.json.issues as { path: string; message: string }[]).map((i) => i.path);
    expect(paths).toContain("schemaVersion");
    expect(paths).toContain("tokenEvents.0.hour");
    expect(await t.run(async (ctx) => ctx.db.query("machines").collect())).toHaveLength(0);
  });

  it("rejects a machine registered to another user with 409 and writes nothing", async () => {
    const t = setup();
    const alice = await userWithToken(t, "alice");
    const bob = await userWithToken(t, "bob");
    expect((await postSync(t, bob.raw, makeBatch())).status).toBe(200);
    const res = await postSync(t, alice.raw, makeBatch({ sessions: [makeSession({ sessionId: "s1" })] }));
    expect(res.status).toBe(409);
    expect(res.json).toEqual({ ok: false, error: "machine_conflict", message: expect.any(String) });
    expect(await t.run(async (ctx) => ctx.db.query("sessions").collect())).toHaveLength(0);
  });

  it("answers 503 with Retry-After when a mutation throws unexpectedly", async () => {
    const t = setup();
    const { userId, raw } = await userWithToken(t, "alice");
    // Two documents with the same sessionId violate the by_sessionId invariant; `.unique()` throws.
    await t.run(async (ctx) => {
      for (let i = 0; i < 2; i++) {
        await ctx.db.insert("sessions", {
          ...makeSession({ sessionId: "dup" }),
          userId,
          machineId: "machine-1",
          syncedAt: T0,
        });
      }
    });
    const res = await postSync(t, raw, makeBatch({ sessions: [makeSession({ sessionId: "dup" })] }));
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("5");
    expect(res.json).toEqual({ ok: false, error: "internal", message: expect.any(String) });
  });

  it("leaves a pre-existing machine's lastSyncAt untouched when a later chunk throws, but advances it on the next successful sync", async () => {
    const t = setup();
    const { userId, raw } = await userWithToken(t, "alice");

    const first = await postSync(t, raw, makeBatch());
    expect(first.status).toBe(200);
    const firstSyncAt = first.json.serverTime;
    const afterFirst = await t.run(async (ctx) => ctx.db.query("machines").first());
    expect(afterFirst?.lastSyncAt).toBe(firstSyncAt);

    // Same trick as the 503 test above: upsertMachine (patch) commits before upsertSessions throws,
    // so finishSync never runs and lastSyncAt must stay at its previous, last-known-good value.
    await t.run(async (ctx) => {
      for (let i = 0; i < 2; i++) {
        await ctx.db.insert("sessions", {
          ...makeSession({ sessionId: "dup" }),
          userId,
          machineId: "machine-1",
          syncedAt: T0,
        });
      }
    });
    const failed = await postSync(t, raw, makeBatch({ sessions: [makeSession({ sessionId: "dup" })] }));
    expect(failed.status).toBe(503);
    const afterFailure = await t.run(async (ctx) => ctx.db.query("machines").first());
    expect(afterFailure?.lastSyncAt).toBe(firstSyncAt);

    const second = await postSync(t, raw, makeBatch());
    expect(second.status).toBe(200);
    expect(second.json.serverTime).toBeGreaterThanOrEqual(firstSyncAt);
    const afterSecond = await t.run(async (ctx) => ctx.db.query("machines").first());
    expect(afterSecond?.lastSyncAt).toBe(second.json.serverTime);
  });
});

describe("POST /api/v1/sync happy path", () => {
  it("stores machine, sessions, events, rate limit and answers with the contract shape", async () => {
    vi.stubEnv("LATEST_CLI_VERSION", "0.9.0-build.202609011200.abc1234");
    const t = setup();
    const { userId, raw, tokenId } = await userWithToken(t, "alice");
    const batch = makeBatch({
      machine: makeMachine({ hostname: null }),
      sessions: [makeSession({ sessionId: "s1" }), makeSession({ sessionId: "s2", project: "project-b" })],
      tokenEvents: [
        makeEvent({ sessionId: "s1", seq: 3 }),
        makeEvent({ sessionId: "s1", seq: 7, hour: 10 }),
        makeEvent({ sessionId: "s2", seq: 2, project: "project-b" }),
      ],
      rateLimit: { observedAt: T0, usedPercent: 42, windowMinutes: 10080, resetsAt: T0 + 86_400_000 },
    });
    const res = await postSync(t, raw, batch);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({
      ok: true,
      accepted: {
        sessions: { inserted: 2, updated: 0, unchanged: 0 },
        events: { inserted: 3, updated: 0, unchanged: 0 },
      },
      conflicts: { sessions: [], events: 0 },
      serverTime: expect.any(Number),
      latestCliVersion: "0.9.0-build.202609011200.abc1234",
      limits: { maxBodyBytes: MAX_BODY_BYTES, maxSessions: 500, maxEvents: 5000 },
    });

    const machine = await t.run(async (ctx) => ctx.db.query("machines").first());
    expect(machine).toMatchObject({
      machineId: "machine-1",
      userId,
      label: "brisk-otter",
      cliVersion: "0.1.0-test",
      lastRateLimit: { usedPercent: 42, observedAt: T0, receivedAt: res.json.serverTime },
    });
    expect(machine?.hostname).toBeUndefined();

    const rollup = await getRollup(t, userId, "2026-08-31");
    expect(rollup).toMatchObject({ sessions: 2, responses: 3, turns: 4 });
    expect(rollup?.tokens.total).toBe(1800);
    expect(rollup?.byProject.map((p) => p.key)).toEqual(["project-a", "project-b"]);

    const token = await t.run(async (ctx) => ctx.db.get(tokenId));
    expect(token?.lastUsedAt).toBe(res.json.serverTime);
  });

  it("reports null latestCliVersion when the env var is unset", async () => {
    vi.stubEnv("LATEST_CLI_VERSION", "");
    const t = setup();
    const { raw } = await userWithToken(t, "alice");
    const res = await postSync(t, raw, makeBatch());
    expect(res.status).toBe(200);
    expect(res.json.latestCliVersion).toBeNull();
  });
});
