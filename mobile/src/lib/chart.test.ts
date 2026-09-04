import { describe, expect, it } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { TrendsResult } from "@convex/lib/types";
import { OTHER_KEY } from "@shared/constants";
import { assignSlots } from "./colors";
import {
  niceCeiling,
  pickLabels,
  shareSegments,
  stackByModel,
  stackByUser,
  stackSingle,
} from "./chart";

const tokens = { input: 0, cachedInput: 0, cacheWrite: 0, output: 0, reasoning: 0, total: 0 };

const trends: TrendsResult = {
  bucket: "day",
  points: [
    {
      bucket: "2026-09-01",
      total: 300,
      tokens,
      costUsd: 3,
      activeMs: 3_600_000,
      sessions: 1,
      byUser: [
        { key: "u1", tokens: 200, costUsd: 2, activeMs: 0 },
        { key: "u2", tokens: 100, costUsd: 1, activeMs: 0 },
      ],
      byModel: [
        { key: "gpt-5.6-sol", tokens: 250 },
        { key: OTHER_KEY, tokens: 50 },
      ],
    },
    {
      bucket: "2026-09-02",
      total: 50,
      tokens,
      costUsd: 0.5,
      activeMs: 1_800_000,
      sessions: 1,
      byUser: [{ key: "u2", tokens: 50, costUsd: 0.5, activeMs: 0 }],
      byModel: [{ key: "gpt-5.6-luna", tokens: 50 }],
    },
  ],
  users: [
    { userId: "u1" as Id<"users">, name: "Alice", imageUrl: null },
    { userId: "u2" as Id<"users">, name: "Bob", imageUrl: null },
  ],
  models: ["gpt-5.6-sol", "gpt-5.6-luna", OTHER_KEY],
  peak: { bucket: "2026-09-01", total: 300 },
  unpricedModels: [],
};

describe("stackByUser", () => {
  it("orders series by total, names them, zero-fills gaps and finds the peak", () => {
    const colors = assignSlots(["u1", "u2"]);
    const s = stackByUser(trends, colors);
    expect(s.series.map((x) => x.label)).toEqual(["Alice", "Bob"]);
    expect(s.bars.map((b) => b.values)).toEqual([
      [200, 100],
      [0, 50],
    ]);
    expect(s.bars[0]?.label).toBe("Sep 1");
    expect(s.max).toBe(300);
    expect(s.peak).toEqual({ label: "Sep 1", total: 300 });
  });
});

describe("stackByModel", () => {
  it("never lets a server-folded (other) take a ranked slot; it merges into Other", () => {
    const s = stackByModel(trends, assignSlots(["gpt-5.6-sol", "gpt-5.6-luna"]), 5);
    expect(s.series.map((x) => x.label)).toEqual(["gpt-5.6-sol", "gpt-5.6-luna", "Other"]);
    expect(s.bars[0]?.values).toEqual([250, 0, 50]);
  });
});

describe("stackSingle", () => {
  it("maps tokens, cost and hours", () => {
    expect(stackSingle(trends, "tokens", "#000").bars.map((b) => b.total)).toEqual([300, 50]);
    expect(stackSingle(trends, "cost", "#000").bars.map((b) => b.total)).toEqual([3, 0.5]);
    expect(stackSingle(trends, "hours", "#000").bars.map((b) => b.total)).toEqual([1, 0.5]);
  });
});

describe("axis helpers", () => {
  it("pickLabels keeps both ends and spreads the rest", () => {
    expect(pickLabels(3, 5)).toEqual([0, 1, 2]);
    expect(pickLabels(30, 4)).toEqual([0, 10, 19, 29]);
    expect(pickLabels(0, 4)).toEqual([]);
  });
  it("niceCeiling rounds up to 1/2/5 × 10^n", () => {
    expect(niceCeiling(0)).toBe(1);
    expect(niceCeiling(7)).toBe(10);
    expect(niceCeiling(1_300_000)).toBe(2_000_000);
    expect(niceCeiling(4_000_000)).toBe(5_000_000);
    expect(niceCeiling(5_000_000)).toBe(5_000_000);
  });
});

describe("shareSegments", () => {
  it("keeps the top n, folds the rest into Other and normalises shares", () => {
    const items = [
      { key: "a", value: 50 },
      { key: "b", value: 30 },
      { key: "c", value: 15 },
      { key: "d", value: 5 },
    ];
    const seg = shareSegments(items, () => "#123", 2);
    expect(seg.map((s) => [s.label, s.value])).toEqual([
      ["a", 50],
      ["b", 30],
      ["Other", 20],
    ]);
    expect(seg.reduce((acc, s) => acc + s.share, 0)).toBeCloseTo(1);
    expect(seg[2]?.color).toBe("#9aa3ae");
  });
});
