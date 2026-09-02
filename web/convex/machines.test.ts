import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import { withUser, registerUser, setup } from "./test.helpers";

describe("machines", () => {
  it("lists machines newest-sync first with null-filled optionals and scopes by user", async () => {
    const t = setup();
    const alice = await registerUser(t, "alice");
    const bob = await registerUser(t, "bob");
    await t.run(async (ctx) => {
      await ctx.db.insert("machines", {
        machineId: "machine-1", userId: alice, label: "brisk-otter", platform: "darwin", arch: "arm64",
        cliVersion: "0.1.0", firstSeenAt: 1, lastSyncAt: 100,
        lastRateLimit: { observedAt: 90, usedPercent: 10, windowMinutes: 10080, limitId: "primary", receivedAt: 100 },
      });
      await ctx.db.insert("machines", {
        machineId: "machine-2", userId: bob, label: "calm-heron", platform: "linux",
        cliVersion: "0.1.0", firstSeenAt: 1, lastSyncAt: 200,
      });
    });
    const all = await withUser(t, "alice").query(api.machines.list, {});
    expect(all.map((m) => m.machineId)).toEqual(["machine-2", "machine-1"]);
    expect(all[1]).toEqual({
      _id: expect.any(String), machineId: "machine-1", userId: alice, label: "brisk-otter", hostname: null,
      platform: "darwin", arch: "arm64", nodeVersion: null, cliVersion: "0.1.0", codexVersion: null,
      codexLatestVersion: null, tz: null, firstSeenAt: 1, lastSyncAt: 100,
      lastRateLimit: { usedPercent: 10, windowMinutes: 10080, resetsAt: null, planType: null, observedAt: 90, receivedAt: 100 },
    });
    expect(all[0]?.lastRateLimit).toBeNull();
    const mine = await withUser(t, "alice").query(api.machines.list, { userId: bob });
    expect(mine.map((m) => m.machineId)).toEqual(["machine-2"]);
  });

  it("renames own machines only and validates the label", async () => {
    const t = setup();
    const alice = await registerUser(t, "alice");
    await registerUser(t, "bob");
    await t.run(async (ctx) => {
      await ctx.db.insert("machines", {
        machineId: "machine-1", userId: alice, label: "brisk-otter", platform: "darwin",
        cliVersion: "0.1.0", firstSeenAt: 1, lastSyncAt: 1,
      });
    });
    expect(await withUser(t, "alice").mutation(api.machines.rename, { machineId: "machine-1", label: "  work laptop " })).toBeNull();
    expect((await withUser(t, "alice").query(api.machines.list, {}))[0]?.label).toBe("work laptop");
    await expect(withUser(t, "bob").mutation(api.machines.rename, { machineId: "machine-1", label: "x" })).rejects.toMatchObject({
      data: { code: "forbidden" },
    });
    await expect(withUser(t, "alice").mutation(api.machines.rename, { machineId: "machine-1", label: "   " })).rejects.toMatchObject({
      data: { code: "bad_label" },
    });
    await expect(withUser(t, "alice").mutation(api.machines.rename, { machineId: "nope", label: "x" })).rejects.toMatchObject({
      data: { code: "forbidden" },
    });
  });
});
