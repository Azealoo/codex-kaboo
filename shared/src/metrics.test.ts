import { describe, expect, it } from "vitest";
import {
  addTokens, addTtft, cacheHitRate, cacheSavings, costOf, emptyTokens, emptyTtft, mergeKeyCounts,
  percentChange, ratio, sortByKey, ttftBucketIndex, ttftMean, ttftMedianApprox,
} from "./metrics";
import type { Ttft } from "./sync";

const price = { inputUsdPerMTok: 2, cachedInputUsdPerMTok: 0.2, outputUsdPerMTok: 10 };
const tokens = { input: 1_000_000, cachedInput: 600_000, cacheWrite: 0, output: 100_000, reasoning: 40_000, total: 1_100_000 };

describe("cost", () => {
  it("prices uncached input, cached input and output (reasoning split at the output price)", () => {
    const c = costOf(tokens, price);
    expect(c.input).toBeCloseTo(0.8, 10); // 400k × $2/M
    expect(c.cached).toBeCloseTo(0.12, 10); // 600k × $0.2/M
    expect(c.output).toBeCloseTo(0.6, 10); // 60k × $10/M
    expect(c.reasoning).toBeCloseTo(0.4, 10); // 40k × $10/M
    expect(c.total).toBeCloseTo(1.92, 10);
  });
  it("computes cache savings versus paying full input price", () => {
    expect(cacheSavings(tokens, price)).toBeCloseTo(0.6 * 1.8, 10);
  });
  it("never goes negative with inconsistent counts", () => {
    const c = costOf({ input: 10, cachedInput: 20, cacheWrite: 0, output: 5, reasoning: 9, total: 15 }, price);
    expect(c.input).toBe(0);
    expect(c.output).toBe(0);
    expect(c.reasoning).toBeCloseTo(5e-5, 12);
  });
});

describe("rates", () => {
  it("returns null for zero denominators", () => {
    expect(ratio(1, 0)).toBeNull();
    expect(ratio(2, 4)).toBe(0.5);
    expect(cacheHitRate(tokens)).toBeCloseTo(0.6, 10);
    expect(cacheHitRate(emptyTokens())).toBeNull();
  });
  it("percentChange is null when previous is null or 0", () => {
    expect(percentChange(10, null)).toBeNull();
    expect(percentChange(10, 0)).toBeNull();
    expect(percentChange(125, 100)).toBeCloseTo(0.25, 10);
    expect(percentChange(50, 100)).toBeCloseTo(-0.5, 10);
  });
});

describe("sums", () => {
  it("adds tokens and ttft field-wise", () => {
    const a = addTokens(tokens, tokens);
    expect(a.input).toBe(2_000_000);
    expect(a.total).toBe(2_200_000);
    const h1: Ttft = { count: 1, sumMs: 300, hist: [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
    const h2: Ttft = { count: 2, sumMs: 5000, hist: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1] };
    const s = addTtft(h1, h2);
    expect(s).toEqual({ count: 3, sumMs: 5300, hist: [0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1] });
    expect(emptyTtft().hist).toHaveLength(16);
  });
});

describe("ttft histogram", () => {
  it("buckets by upper bound", () => {
    expect(ttftBucketIndex(0)).toBe(0);
    expect(ttftBucketIndex(250)).toBe(0);
    expect(ttftBucketIndex(251)).toBe(1);
    expect(ttftBucketIndex(60000)).toBe(14);
    expect(ttftBucketIndex(60001)).toBe(15);
    expect(ttftBucketIndex(10_000_000)).toBe(15);
  });
  it("interpolates the median inside the bucket holding the count/2-th sample", () => {
    const four: Ttft = { count: 4, sumMs: 1500, hist: [0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
    expect(ttftMedianApprox(four)).toBeCloseTo(375, 6); // bucket (250, 500], halfway
    const one: Ttft = { count: 1, sumMs: 900, hist: [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
    expect(ttftMedianApprox(one)).toBeCloseTo(875, 6); // (750, 1000], halfway
    const last: Ttft = { count: 1, sumMs: 90000, hist: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1] };
    expect(ttftMedianApprox(last)).toBeCloseTo(90000, 6); // (60000, 120000]
    const split: Ttft = { count: 4, sumMs: 0, hist: [2, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
    expect(ttftMedianApprox(split)).toBeCloseTo(250, 6);
    expect(ttftMedianApprox(emptyTtft())).toBeNull();
    expect(ttftMean(four)).toBe(375);
    expect(ttftMean(emptyTtft())).toBeNull();
  });
});

describe("keyed arrays", () => {
  it("merges, caps and folds into (other), sorted by key", () => {
    const merged = mergeKeyCounts(
      [[{ key: "b", count: 5 }, { key: "a", count: 1 }], [{ key: "c", count: 7 }, { key: "a", count: 4 }]],
      100,
      "(other)",
    );
    expect(merged).toEqual([{ key: "a", count: 5 }, { key: "b", count: 5 }, { key: "c", count: 7 }]);
    const capped = mergeKeyCounts([[{ key: "b", count: 5 }, { key: "a", count: 1 }, { key: "c", count: 7 }]], 2, "(other)");
    expect(capped).toEqual([{ key: "(other)", count: 6 }, { key: "c", count: 7 }]);
    expect(mergeKeyCounts([], 10, "(other)")).toEqual([]);
    expect(sortByKey([{ key: "z" }, { key: "m" }, { key: "a" }]).map((x) => x.key)).toEqual(["a", "m", "z"]);
  });
});
