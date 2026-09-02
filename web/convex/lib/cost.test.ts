// web/convex/lib/cost.test.ts
import { describe, expect, it } from "vitest";
import { OTHER_KEY } from "../../../shared/src/constants";
import type { ModelPrice } from "../../../shared/src/metrics";
import type { Tokens } from "../../../shared/src/sync";
import { setup } from "../test.helpers";
import { loadPriceMap, priceTokens, sumCost, type PriceMap } from "./cost";

const sol: ModelPrice = { inputUsdPerMTok: 2, cachedInputUsdPerMTok: 0.2, outputUsdPerMTok: 10 };
const tokens: Tokens = {
  input: 1_000_000,
  cachedInput: 400_000,
  cacheWrite: 0,
  output: 100_000,
  reasoning: 20_000,
  total: 1_100_000,
};

describe("priceTokens", () => {
  it("splits cost into input, cached, output and reasoning", () => {
    const prices: PriceMap = new Map([["gpt-5.6-sol", sol]]);
    const cost = priceTokens("gpt-5.6-sol", tokens, prices);
    expect(cost?.input).toBeCloseTo(1.2, 10);
    expect(cost?.cached).toBeCloseTo(0.08, 10);
    expect(cost?.output).toBeCloseTo(0.8, 10);
    expect(cost?.reasoning).toBeCloseTo(0.2, 10);
    expect(cost?.total).toBeCloseTo(2.28, 10);
  });
  it("returns null for an unpriced model", () => {
    expect(priceTokens("codex-auto-review", tokens, new Map())).toBeNull();
  });
});

describe("sumCost", () => {
  it("adds priced models, flags unpriced ones and reports cache savings", () => {
    const prices: PriceMap = new Map([["gpt-5.6-sol", sol]]);
    const summary = sumCost(
      [
        { key: "gpt-5.6-sol", tokens },
        { key: "codex-auto-review", tokens: { ...tokens, total: 5 } },
        {
          key: "gpt-5.6-luna",
          tokens: { input: 0, cachedInput: 0, cacheWrite: 0, output: 0, reasoning: 0, total: 0 },
        },
      ],
      prices,
    );
    expect(summary.totalUsd).toBeCloseTo(2.28, 10);
    expect(summary.byKind.input).toBeCloseTo(1.2, 10);
    expect(summary.byKind.reasoning).toBeCloseTo(0.2, 10);
    expect(summary.cacheSavingsUsd).toBeCloseTo(0.72, 10);
    expect(summary.unpricedModels).toEqual(["codex-auto-review"]);
  });
  it("never reports the (other) fold key as an unpriced model", () => {
    // `(other)` is the 100-entry keyed-array fold, not a model: listing it would render a
    // synthetic name in the dashboard's "no price row" warning.
    const summary = sumCost(
      [
        { key: OTHER_KEY, tokens },
        { key: "codex-auto-review", tokens },
      ],
      new Map(),
    );
    expect(summary.unpricedModels).toEqual(["codex-auto-review"]);
  });

  it("is zero for no models", () => {
    expect(sumCost([], new Map())).toEqual({
      totalUsd: 0,
      byKind: { input: 0, cached: 0, output: 0, reasoning: 0 },
      cacheSavingsUsd: 0,
      unpricedModels: [],
    });
  });
});

describe("loadPriceMap", () => {
  it("reads every modelPrices row into a map", async () => {
    const t = setup();
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
    const entries = await t.run(async (ctx) => [...(await loadPriceMap(ctx)).entries()]);
    expect(entries).toEqual([["gpt-5.6-sol", sol]]);
  });

  it("reflects an edited price row on the next load", async () => {
    const t = setup();
    const id = await t.run(async (ctx) =>
      ctx.db.insert("modelPrices", {
        model: "gpt-5.6-sol",
        inputUsdPerMTok: 2,
        cachedInputUsdPerMTok: 0.2,
        outputUsdPerMTok: 10,
        source: "seed",
        updatedAt: 1,
      }),
    );
    const before = await t.run(async (ctx) => (await loadPriceMap(ctx)).get("gpt-5.6-sol"));
    expect(before).toEqual(sol);

    await t.run(async (ctx) => ctx.db.patch(id, { inputUsdPerMTok: 3, updatedAt: 2 }));

    const after = await t.run(async (ctx) => (await loadPriceMap(ctx)).get("gpt-5.6-sol"));
    expect(after).toEqual({ ...sol, inputUsdPerMTok: 3 });
  });
});
