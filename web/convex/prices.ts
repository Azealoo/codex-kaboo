import { ConvexError, v } from "convex/values";
import { MAX_PRICE_USD_PER_MTOK } from "../../shared/src/constants";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { authedMutation, authedQuery } from "./lib/auth";
import type { PriceRow } from "./lib/types";

/**
 * Spec "Seed price table" (USD per million tokens).
 *
 * `codex-auto-review` is the model Codex's own review sub-agent runs on. It used to be left out
 * deliberately, which made the README's "sub-agent threads count toward token totals and cost"
 * false on any fresh deployment: those tokens landed in every total but cost $0, and the cost card
 * carried a permanent "Unpriced: codex-auto-review" footer. OpenAI publishes no rate for it, so it
 * is seeded at gpt-5.6-sol's — an assumption, not a quote, and editable in Settings like any other
 * row. A wrong price is still closer than treating a fifth of the tokens as free.
 */
export const SEED_PRICES = [
  { model: "gpt-5.6-sol", inputUsdPerMTok: 2, cachedInputUsdPerMTok: 0.2, outputUsdPerMTok: 10 },
  {
    model: "codex-auto-review",
    inputUsdPerMTok: 2,
    cachedInputUsdPerMTok: 0.2,
    outputUsdPerMTok: 10,
  },
  {
    model: "gpt-5.6-luna",
    inputUsdPerMTok: 0.2,
    cachedInputUsdPerMTok: 0.02,
    outputUsdPerMTok: 1.2,
  },
  { model: "gpt-5.6-terra", inputUsdPerMTok: 2, cachedInputUsdPerMTok: 0.2, outputUsdPerMTok: 12 },
  { model: "gpt-5.5", inputUsdPerMTok: 5, cachedInputUsdPerMTok: 0.5, outputUsdPerMTok: 30 },
  { model: "gpt-5.4", inputUsdPerMTok: 2.5, cachedInputUsdPerMTok: 0.25, outputUsdPerMTok: 15 },
  {
    model: "gpt-5.4-mini",
    inputUsdPerMTok: 0.75,
    cachedInputUsdPerMTok: 0.075,
    outputUsdPerMTok: 4.5,
  },
  {
    model: "gpt-5.3-codex",
    inputUsdPerMTok: 1.75,
    cachedInputUsdPerMTok: 0.175,
    outputUsdPerMTok: 14,
  },
  {
    model: "gpt-5.2-codex",
    inputUsdPerMTok: 1.75,
    cachedInputUsdPerMTok: 0.175,
    outputUsdPerMTok: 14,
  },
  {
    model: "gpt-5.1-codex",
    inputUsdPerMTok: 1.25,
    cachedInputUsdPerMTok: 0.13,
    outputUsdPerMTok: 10,
  },
  {
    model: "gpt-5.1-codex-mini",
    inputUsdPerMTok: 0.25,
    cachedInputUsdPerMTok: 0.03,
    outputUsdPerMTok: 2,
  },
  { model: "gpt-5", inputUsdPerMTok: 1.25, cachedInputUsdPerMTok: 0.125, outputUsdPerMTok: 10 },
  { model: "gpt-5-mini", inputUsdPerMTok: 0.25, cachedInputUsdPerMTok: 0.025, outputUsdPerMTok: 2 },
  { model: "o3", inputUsdPerMTok: 2, cachedInputUsdPerMTok: 0.5, outputUsdPerMTok: 8 },
  { model: "o4-mini", inputUsdPerMTok: 1.1, cachedInputUsdPerMTok: 0.275, outputUsdPerMTok: 4.4 },
] as const;

function toRow(doc: Doc<"modelPrices">): PriceRow {
  return {
    _id: doc._id,
    model: doc.model,
    inputUsdPerMTok: doc.inputUsdPerMTok,
    cachedInputUsdPerMTok: doc.cachedInputUsdPerMTok,
    outputUsdPerMTok: doc.outputUsdPerMTok,
    source: doc.source,
    updatedAt: doc.updatedAt,
  };
}

export const list = authedQuery({
  args: {},
  handler: async (ctx): Promise<PriceRow[]> => {
    const docs = await ctx.db.query("modelPrices").withIndex("by_model").order("asc").collect();
    return docs.map(toRow);
  },
});

export const upsert = authedMutation({
  args: {
    model: v.string(),
    inputUsdPerMTok: v.number(),
    cachedInputUsdPerMTok: v.number(),
    outputUsdPerMTok: v.number(),
  },
  handler: async (ctx, args): Promise<Id<"modelPrices">> => {
    const model = args.model.trim();
    if (model.length === 0 || model.length > 256) throw new ConvexError({ code: "bad_model" });
    for (const value of [args.inputUsdPerMTok, args.cachedInputUsdPerMTok, args.outputUsdPerMTok]) {
      // Upper bound is a typo guard (e.g. `2000000` fat-fingered for `2.00`), not a policy limit —
      // see MAX_PRICE_USD_PER_MTOK's comment. Re-validated here even though the client already
      // enforces it, so a bypassed/future client can never write an implausible price.
      if (!Number.isFinite(value) || value < 0 || value > MAX_PRICE_USD_PER_MTOK) {
        throw new ConvexError({ code: "bad_price" });
      }
    }
    const fields = {
      inputUsdPerMTok: args.inputUsdPerMTok,
      cachedInputUsdPerMTok: args.cachedInputUsdPerMTok,
      outputUsdPerMTok: args.outputUsdPerMTok,
      source: "manual",
      updatedAt: Date.now(),
      updatedBy: ctx.user._id,
    };
    const existing = await ctx.db
      .query("modelPrices")
      .withIndex("by_model", (q) => q.eq("model", model))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return existing._id;
    }
    return await ctx.db.insert("modelPrices", { model, ...fields });
  },
});

export const remove = authedMutation({
  args: { model: v.string() },
  handler: async (ctx, { model }): Promise<null> => {
    const existing = await ctx.db
      .query("modelPrices")
      .withIndex("by_model", (q) => q.eq("model", model.trim()))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
    return null;
  },
});

/** `npx convex run prices:seed` once per deployment; safe to re-run. */
export const seed = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ inserted: number }> => {
    const now = Date.now();
    let inserted = 0;
    for (const price of SEED_PRICES) {
      const existing = await ctx.db
        .query("modelPrices")
        .withIndex("by_model", (q) => q.eq("model", price.model))
        .unique();
      if (existing) continue;
      await ctx.db.insert("modelPrices", { ...price, source: "seed", updatedAt: now });
      inserted += 1;
    }
    return { inserted };
  },
});
