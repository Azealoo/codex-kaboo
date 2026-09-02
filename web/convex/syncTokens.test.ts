// web/convex/syncTokens.test.ts
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import { sha256Hex } from "./lib/hash";
import { withUser, registerUser, setup, userWithToken } from "./test.helpers";

describe("syncTokens.create", () => {
  it("returns the raw token once and stores only its hash", async () => {
    const t = setup();
    const aliceId = await registerUser(t, "alice");
    const created = await withUser(t, "alice").action(api.syncTokens.create, { name: "  laptop " });
    expect(created.token).toMatch(/^ck_[A-Za-z0-9_-]{43}$/);
    expect(created.prefix).toBe(created.token.slice(0, 9));
    const rows = await t.run(async (ctx) => ctx.db.query("syncTokens").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      _id: created.id,
      userId: aliceId,
      name: "laptop",
      prefix: created.prefix,
      tokenHash: await sha256Hex(created.token),
    });
    expect(JSON.stringify(rows[0])).not.toContain(created.token);
    const listed = await withUser(t, "alice").query(api.syncTokens.list, {});
    expect(listed).toEqual([
      {
        _id: created.id,
        name: "laptop",
        prefix: created.prefix,
        createdAt: expect.any(Number),
        lastUsedAt: null,
        revokedAt: null,
      },
    ]);
    expect(JSON.stringify(listed)).not.toContain("tokenHash");
  });

  it("rejects anonymous callers, unregistered users and blank names", async () => {
    const t = setup();
    await expect(t.action(api.syncTokens.create, { name: "x" })).rejects.toMatchObject({
      data: { code: "unauthenticated" },
    });
    await expect(withUser(t, "alice").action(api.syncTokens.create, { name: "x" })).rejects.toMatchObject({
      data: { code: "user_not_registered" },
    });
    await registerUser(t, "alice");
    await expect(withUser(t, "alice").action(api.syncTokens.create, { name: "   " })).rejects.toMatchObject({
      data: { code: "bad_name" },
    });
  });
});

describe("syncTokens.list", () => {
  it("shows only the caller's tokens, newest first", async () => {
    const t = setup();
    const alice = await userWithToken(t, "alice");
    await userWithToken(t, "bob");
    const second = await withUser(t, "alice").action(api.syncTokens.create, { name: "desktop" });
    const listed = await withUser(t, "alice").query(api.syncTokens.list, {});
    expect(listed.map((row) => row._id)).toEqual([second.id, alice.tokenId]);
  });
});

describe("syncTokens.revoke", () => {
  it("revokes own tokens only", async () => {
    const t = setup();
    const alice = await userWithToken(t, "alice");
    await registerUser(t, "bob");
    await expect(
      withUser(t, "bob").mutation(api.syncTokens.revoke, { tokenId: alice.tokenId }),
    ).rejects.toMatchObject({ data: { code: "forbidden" } });
    expect(await withUser(t, "alice").mutation(api.syncTokens.revoke, { tokenId: alice.tokenId })).toBeNull();
    const listed = await withUser(t, "alice").query(api.syncTokens.list, {});
    expect(listed[0]?.revokedAt).toEqual(expect.any(Number));
    const lookup = await t.query(internal.syncTokens.lookupByHash, {
      tokenHash: await sha256Hex(alice.raw),
    });
    expect(lookup?.revokedAt).toEqual(expect.any(Number));
  });
});

describe("lookupByHash / touchLastUsed", () => {
  it("resolves a token to its user without the hash and throttles lastUsedAt to once a minute", async () => {
    const t = setup();
    const { userId, raw, tokenId } = await userWithToken(t, "alice");
    const found = await t.query(internal.syncTokens.lookupByHash, { tokenHash: await sha256Hex(raw) });
    expect(found).toEqual({
      tokenId,
      userId,
      name: "test",
      prefix: "ck_alice0",
      revokedAt: null,
      lastUsedAt: null,
      user: { name: "Alice", email: "alice@example.com" },
    });
    expect(await t.query(internal.syncTokens.lookupByHash, { tokenHash: "0".repeat(64) })).toBeNull();

    expect(await t.mutation(internal.syncTokens.touchLastUsed, { tokenId, now: 1_000_000 })).toBe(true);
    expect(await t.mutation(internal.syncTokens.touchLastUsed, { tokenId, now: 1_059_999 })).toBe(false);
    expect(await t.mutation(internal.syncTokens.touchLastUsed, { tokenId, now: 1_060_000 })).toBe(true);
    const row = await t.run(async (ctx) => ctx.db.get(tokenId));
    expect(row?.lastUsedAt).toBe(1_060_000);
  });
});
