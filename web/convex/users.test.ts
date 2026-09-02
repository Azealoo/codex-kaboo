// web/convex/users.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import { withUser, registerUser, setup } from "./test.helpers";

afterEach(() => vi.useRealTimers());

describe("users.ensure", () => {
  it("creates the user once and refreshes lastSeenAt on repeat calls", async () => {
    const t = setup();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T09:00:00Z"));
    const first = await withUser(t, "alice").mutation(api.users.ensure, {});
    vi.setSystemTime(new Date("2026-08-31T10:00:00Z"));
    const second = await withUser(t, "alice").mutation(api.users.ensure, {});
    expect(second).toBe(first);
    const users = await t.run(async (ctx) => ctx.db.query("users").collect());
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      clerkId: "user_alice",
      tokenIdentifier: "https://clerk.example|user_alice",
      name: "Alice",
      email: "alice@example.com",
      createdAt: Date.UTC(2026, 7, 31, 9),
      lastSeenAt: Date.UTC(2026, 7, 31, 10),
    });
  });

  it("rejects anonymous callers", async () => {
    const t = setup();
    await expect(t.mutation(api.users.ensure, {})).rejects.toMatchObject({
      data: { code: "unauthenticated" },
    });
  });
});

describe("authed functions", () => {
  it("require a Clerk identity and a registered user", async () => {
    const t = setup();
    await expect(t.query(api.users.me, {})).rejects.toMatchObject({
      data: { code: "unauthenticated" },
    });
    await expect(withUser(t, "alice").query(api.users.me, {})).rejects.toMatchObject({
      data: { code: "user_not_registered" },
    });
  });
});

describe("users.me / users.list", () => {
  it("returns the caller and lists everyone sorted by name", async () => {
    const t = setup();
    const bobId = await registerUser(t, "bob");
    const aliceId = await registerUser(t, "alice");
    const me = await withUser(t, "alice").query(api.users.me, {});
    expect(me).toMatchObject({
      _id: aliceId,
      clerkId: "user_alice",
      name: "Alice",
      email: "alice@example.com",
      imageUrl: null,
    });
    const list = await withUser(t, "bob").query(api.users.list, {});
    expect(list).toEqual([
      { userId: aliceId, name: "Alice", imageUrl: null },
      { userId: bobId, name: "Bob", imageUrl: null },
    ]);
  });
});

describe("users.ensure adoption", () => {
  it("does not adopt a pending user with a different email", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        clerkId: "pending:someone-else@example.com",
        tokenIdentifier: "pending:someone-else@example.com",
        email: "someone-else@example.com",
        name: "Someone",
        createdAt: 1,
        lastSeenAt: 1,
      });
    });
    await withUser(t, "alice").mutation(api.users.ensure, {});
    const users = await t.run(async (ctx) => ctx.db.query("users").collect());
    expect(users).toHaveLength(2);
  });
});
