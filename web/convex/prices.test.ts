import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import type { EventInput } from "./lib/aggregate";
import { withUser, registerUser, seedRollup, setup } from "./test.helpers";

const event: EventInput = {
  hour: 9, model: "gpt-5.6-sol", effort: "medium", project: "alpha", isSubagent: false,
  input: 1000, cachedInput: 400, cacheWrite: 0, output: 200, reasoning: 50, total: 1200,
};

describe("prices.seed", () => {
  it("inserts the 14 seed rows once", async () => {
    const t = setup();
    expect(await t.mutation(internal.prices.seed, {})).toEqual({ inserted: 14 });
    expect(await t.mutation(internal.prices.seed, {})).toEqual({ inserted: 0 });
    await registerUser(t, "alice");
    const rows = await withUser(t, "alice").query(api.prices.list, {});
    expect(rows).toHaveLength(14);
    expect(rows.map((r) => r.model)).toEqual([...rows.map((r) => r.model)].sort());
    expect(rows.find((r) => r.model === "gpt-5.6-sol")).toMatchObject({
      inputUsdPerMTok: 2, cachedInputUsdPerMTok: 0.2, outputUsdPerMTok: 10, source: "seed",
    });
    expect(rows.find((r) => r.model === "gpt-5.1-codex-mini")).toMatchObject({
      inputUsdPerMTok: 0.25, cachedInputUsdPerMTok: 0.03, outputUsdPerMTok: 2,
    });
    expect(rows.find((r) => r.model === "codex-auto-review")).toBeUndefined();
  });
});

describe("prices.upsert / remove", () => {
  it("creates, updates, validates and removes prices", async () => {
    const t = setup();
    await registerUser(t, "alice");
    const id = await withUser(t, "alice").mutation(api.prices.upsert, {
      model: " gpt-9 ", inputUsdPerMTok: 1, cachedInputUsdPerMTok: 0.1, outputUsdPerMTok: 5,
    });
    const again = await withUser(t, "alice").mutation(api.prices.upsert, {
      model: "gpt-9", inputUsdPerMTok: 2, cachedInputUsdPerMTok: 0.2, outputUsdPerMTok: 8,
    });
    expect(again).toBe(id);
    const rows = await withUser(t, "alice").query(api.prices.list, {});
    expect(rows).toEqual([
      { _id: id, model: "gpt-9", inputUsdPerMTok: 2, cachedInputUsdPerMTok: 0.2, outputUsdPerMTok: 8, source: "manual", updatedAt: expect.any(Number) },
    ]);
    await expect(withUser(t, "alice").mutation(api.prices.upsert, {
      model: "gpt-9", inputUsdPerMTok: -1, cachedInputUsdPerMTok: 0, outputUsdPerMTok: 0,
    })).rejects.toMatchObject({ data: { code: "bad_price" } });
    await expect(withUser(t, "alice").mutation(api.prices.upsert, {
      model: "  ", inputUsdPerMTok: 1, cachedInputUsdPerMTok: 0, outputUsdPerMTok: 0,
    })).rejects.toMatchObject({ data: { code: "bad_model" } });
    expect(await withUser(t, "alice").mutation(api.prices.remove, { model: "gpt-9" })).toBeNull();
    expect(await withUser(t, "alice").mutation(api.prices.remove, { model: "gpt-9" })).toBeNull();
    expect(await withUser(t, "alice").query(api.prices.list, {})).toEqual([]);
  });

  it("re-prices history in the next stats query", async () => {
    const t = setup();
    const alice = await registerUser(t, "alice");
    await seedRollup(t, alice, "2026-08-31", [event], []);
    const before = await withUser(t, "alice").query(api.stats.summary, { from: "2026-08-31", to: "2026-08-31", previous: false });
    expect(before.metrics.costUsd.current).toBe(0);
    expect(before.unpricedModels).toEqual(["gpt-5.6-sol"]);
    await withUser(t, "alice").mutation(api.prices.upsert, {
      model: "gpt-5.6-sol", inputUsdPerMTok: 2, cachedInputUsdPerMTok: 0.2, outputUsdPerMTok: 10,
    });
    const priced = await withUser(t, "alice").query(api.stats.summary, { from: "2026-08-31", to: "2026-08-31", previous: false });
    expect(priced.metrics.costUsd.current).toBeCloseTo(0.00328, 8);
    expect(priced.unpricedModels).toEqual([]);
    await withUser(t, "alice").mutation(api.prices.upsert, {
      model: "gpt-5.6-sol", inputUsdPerMTok: 4, cachedInputUsdPerMTok: 0.4, outputUsdPerMTok: 20,
    });
    const doubled = await withUser(t, "alice").query(api.stats.summary, { from: "2026-08-31", to: "2026-08-31", previous: false });
    expect(doubled.metrics.costUsd.current).toBeCloseTo(0.00656, 8);
  });
});
