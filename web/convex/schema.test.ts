// web/convex/schema.test.ts
import { describe, expect, it } from "vitest";
import { modules, setup } from "./test.helpers";

describe("schema", () => {
  it("stores a user and finds it through by_clerkId", async () => {
    const t = setup();
    const id = await t.run(async (ctx) =>
      ctx.db.insert("users", {
        clerkId: "user_alice",
        tokenIdentifier: "https://clerk.example|user_alice",
        name: "Alice",
        createdAt: 1_700_000_000_000,
        lastSeenAt: 1_700_000_000_000,
      }),
    );
    const found = await t.run(async (ctx) =>
      ctx.db
        .query("users")
        .withIndex("by_clerkId", (q) => q.eq("clerkId", "user_alice"))
        .unique(),
    );
    expect(found?._id).toBe(id);
  });

  it("rejects a session document that misses required fields", async () => {
    const t = setup();
    await expect(
      t.run(async (ctx) => ctx.db.insert("sessions", { sessionId: "only-id" } as never)),
    ).rejects.toThrow();
  });

  it("enumerates the convex modules for convex-test", () => {
    expect(Object.keys(modules).length).toBeGreaterThan(0);
  });
});
