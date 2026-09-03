import { describe, expect, it } from "vitest";
import type { TrendsResult } from "@convex/lib/types";
import type { Id } from "@convex/_generated/dataModel";
import { CATEGORICAL, OTHER_COLOR, assignSlots } from "./colors";
import {
  bucketLabel,
  costStructureSegments,
  foldTopN,
  shareSegments,
  trendByModel,
  trendByUser,
  trendSingle,
  unpricedFooter,
} from "./chart-data";

const tokens = (total: number) => ({
  input: total,
  cachedInput: 0,
  cacheWrite: 0,
  output: 0,
  reasoning: 0,
  total,
});
const u1 = "u1" as Id<"users">;
const u2 = "u2" as Id<"users">;

const trends: TrendsResult = {
  bucket: "day",
  users: [
    { userId: u1, name: "Ada", imageUrl: null },
    { userId: u2, name: "Bob", imageUrl: null },
  ],
  models: ["gpt-5.6-sol", "gpt-5.6-luna", "m3", "m4", "m5", "m6", "m7", "m8", "m9"],
  peak: { bucket: "2026-09-02", total: 400 },
  unpricedModels: [],
  points: [
    {
      bucket: "2026-09-01",
      total: 100,
      tokens: tokens(100),
      costUsd: 1,
      activeMs: 3_600_000,
      sessions: 1,
      byUser: [{ key: "u1", tokens: 100, costUsd: 1, activeMs: 3_600_000 }],
      byModel: [{ key: "gpt-5.6-sol", tokens: 100 }],
    },
    {
      bucket: "2026-09-02",
      total: 400,
      tokens: tokens(400),
      costUsd: 3,
      activeMs: 7_200_000,
      sessions: 2,
      byUser: [
        { key: "u1", tokens: 100, costUsd: 1, activeMs: 3_600_000 },
        { key: "u2", tokens: 300, costUsd: 2, activeMs: 3_600_000 },
      ],
      byModel: [
        { key: "gpt-5.6-sol", tokens: 100 },
        { key: "gpt-5.6-luna", tokens: 100 },
        { key: "m3", tokens: 20 },
        { key: "m4", tokens: 20 },
        { key: "m5", tokens: 20 },
        { key: "m6", tokens: 10 },
        { key: "m7", tokens: 10 },
        { key: "m8", tokens: 10 },
        { key: "m9", tokens: 10 },
      ],
    },
  ],
};

describe("bucketLabel", () => {
  it("labels days/weeks by day and months by month", () => {
    expect(bucketLabel("2026-09-01", "day")).toBe("Sep 1");
    expect(bucketLabel("2026-08-31", "week")).toBe("Aug 31");
    expect(bucketLabel("2026-09-01", "month")).toBe("Sep 2026");
  });
});

describe("trendByUser", () => {
  const colors = assignSlots(["u1", "u2"]);
  it("builds one slot series per user sorted by total desc, zero-filled rows and the peak", () => {
    const stacked = trendByUser(trends, colors);
    expect(stacked.series.map((s) => s.label)).toEqual(["Bob", "Ada"]);
    expect(stacked.series[0]).toEqual({
      key: "s0",
      label: "Bob",
      color: CATEGORICAL[1],
      entity: "u2",
    });
    expect(stacked.rows).toEqual([
      { x: "2026-09-01", label: "Sep 1", s0: 0, s1: 100 },
      { x: "2026-09-02", label: "Sep 2", s0: 300, s1: 100 },
    ]);
    expect(stacked.peak).toEqual({ x: "2026-09-02", label: "Sep 2", total: 400 });
    expect(stacked.total).toBe(500);
  });
});

describe("trendByModel", () => {
  it("keeps the top 7 models and folds the rest into other, never using dotted keys", () => {
    const colors = assignSlots(["gpt-5.6-sol", "gpt-5.6-luna"]);
    const stacked = trendByModel(trends, colors, 7);
    expect(stacked.series).toHaveLength(8);
    expect(stacked.series[0]).toEqual({
      key: "s0",
      label: "gpt-5.6-sol",
      color: CATEGORICAL[0],
      entity: "gpt-5.6-sol",
    });
    expect(stacked.series[7]).toEqual({
      key: "other",
      label: "Other",
      color: OTHER_COLOR,
      entity: "(other)",
    });
    for (const s of stacked.series) expect(s.key).not.toContain(".");
    expect(stacked.rows[1]?.other).toBe(20); // m8 + m9
    expect(stacked.rows[0]?.other).toBe(0);
  });
});

describe("trendSingle", () => {
  it("maps tokens, cost and hours to a single series", () => {
    expect(trendSingle(trends, "tokens", "#000").rows.map((r) => r.s0)).toEqual([100, 400]);
    expect(trendSingle(trends, "cost", "#000").rows.map((r) => r.s0)).toEqual([1, 3]);
    expect(trendSingle(trends, "hours", "#000").rows.map((r) => r.s0)).toEqual([1, 2]);
    expect(trendSingle(trends, "tokens", "#000").series).toEqual([
      { key: "s0", label: "Tokens", color: "#000", entity: "total" },
    ]);
  });
});

describe("unpricedFooter", () => {
  it("qualifies the cost metric's dollar total when the range has unpriced models", () => {
    // Reviewer's case: a priced main session plus an unpriced codex-auto-review sub-agent still
    // sums to a real $3.00 total that understates true list-price spend — the trend card's Cost
    // view must say so, not print $3.00 unqualified.
    expect(unpricedFooter("cost", ["codex-auto-review"])).toBe("Unpriced: codex-auto-review");
    expect(unpricedFooter("cost", ["codex-auto-review", "gpt-9-preview"])).toBe(
      "Unpriced: codex-auto-review, gpt-9-preview",
    );
  });
  it("says nothing when every model in range is priced", () => {
    expect(unpricedFooter("cost", [])).toBeNull();
  });
  it("says nothing for the tokens/hours metrics, which are exact regardless of pricing", () => {
    expect(unpricedFooter("tokens", ["codex-auto-review"])).toBeNull();
    expect(unpricedFooter("hours", ["codex-auto-review"])).toBeNull();
  });
});

describe("foldTopN / segments", () => {
  it("folds the tail into an other entry only when needed", () => {
    const items = [
      { key: "a", value: 5 },
      { key: "b", value: 3 },
      { key: "c", value: 1 },
    ];
    expect(foldTopN(items, 2)).toEqual([
      { key: "a", value: 5 },
      { key: "b", value: 3 },
      { key: "(other)", value: 1 },
    ]);
    expect(foldTopN(items, 3)).toEqual(items);
  });
  it("computes cost structure shares", () => {
    const segs = costStructureSegments({ input: 5, cached: 1, output: 3, reasoning: 1 });
    expect(segs.map((s) => s.key)).toEqual(["input", "cached", "output", "reasoning"]);
    expect(segs[0]?.share).toBeCloseTo(0.5);
    expect(segs.reduce((acc, s) => acc + s.share, 0)).toBeCloseTo(1);
  });
  it("returns zero shares when everything is zero", () => {
    const segs = costStructureSegments({ input: 0, cached: 0, output: 0, reasoning: 0 });
    expect(segs.every((s) => s.share === 0)).toBe(true);
  });
  it("builds share segments with entity colors", () => {
    const colors = assignSlots(["x", "y"]);
    const segs = shareSegments(
      [
        { key: "y", value: 1 },
        { key: "x", value: 3 },
      ],
      colors,
    );
    expect(segs[0]).toEqual({ key: "x", label: "x", value: 3, share: 0.75, color: CATEGORICAL[0] });
  });
});

describe("foldTopN when the server already folded once", () => {
  // Rollups cap their keyed arrays at 100 and fold the rest into `(other)`, so any breakdown wide
  // enough to have been capped arrives here with that entry already in it -- and a tail summed over
  // 100 keys easily outranks the 8th-largest single key. Keeping it and appending another gives two
  // rows with the same key: a duplicate React key, two "Other" slices in one chart, and a share
  // total that reads as if the tail were counted twice.
  const items = [
    { key: "a", value: 10 },
    { key: "b", value: 8 },
    { key: "(other)", value: 30 },
    { key: "c", value: 2 },
    { key: "d", value: 1 },
  ];

  it("merges the existing entry into the fold rather than emitting two", () => {
    const folded = foldTopN(items, 3);
    expect(folded.filter((i) => i.key === "(other)")).toHaveLength(1);
    expect(new Set(folded.map((i) => i.key)).size).toBe(folded.length);
  });

  it("keeps the folded value equal to everything it stands for", () => {
    const folded = foldTopN(items, 3);
    const sum = (rows: { value: number }[]) => rows.reduce((acc, i) => acc + i.value, 0);
    expect(sum(folded)).toBe(sum(items));
    // All three slots go to real keys -- a, b and c -- and the fold is the old (other) 30 plus the
    // only rankable entry left over, d. Under the old behaviour the incoming (other) outranked
    // both c and d and took a slot, so a real key was pushed out of the chart to make room for it.
    expect(folded.map((i) => i.key)).toEqual(["a", "b", "c", "(other)"]);
    expect(folded.find((i) => i.key === "(other)")?.value).toBe(31);
  });

  it("gives shareSegments one Other slice", () => {
    const segments = shareSegments(items, new Map(), 3);
    expect(segments.filter((s) => s.label === "Other")).toHaveLength(1);
    expect(segments.reduce((acc, s) => acc + s.share, 0)).toBeCloseTo(1);
  });
});
