import { describe, expect, it } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { LeaderboardRow } from "@convex/lib/types";
import { leaderKind, leaderValue, sortLeaderboard } from "./leaderboard";

const row = (id: string, tokens: number, cost: number, lines: number): LeaderboardRow => ({
  userId: id as Id<"users">,
  name: id,
  imageUrl: null,
  tokens: { input: tokens, cachedInput: 0, cacheWrite: 0, output: 0, reasoning: 0, total: tokens },
  costUsd: cost,
  unpriced: false,
  sessions: 1,
  turns: 1,
  messages: 2,
  userMessages: 1,
  linesAdded: lines,
  linesRemoved: 0,
  tokensPerLine: lines > 0 ? tokens / lines : null,
  cacheHitRate: null,
  activeMs: 0,
  rank: 1,
  previousRank: null,
  previousTokens: null,
  change: null,
});

describe("leaderboard helpers", () => {
  it("reads the metric value and its display kind", () => {
    const r = row("a", 1000, 2.5, 10);
    expect(leaderValue(r, "tokens")).toBe(1000);
    expect(leaderValue(r, "cost")).toBe(2.5);
    expect(leaderValue(r, "lines")).toBe(10);
    expect(leaderValue(r, "tokensPerLine")).toBe(100);
    expect(leaderValue(row("b", 1000, 0, 0), "tokensPerLine")).toBeNull();
    expect(leaderKind("cost")).toBe("usd");
    expect(leaderKind("tokensPerLine")).toBe("tokens");
  });
  it("sorts descending with nulls last and keeps ties by name", () => {
    const rows = [row("b", 10, 0, 0), row("a", 10, 0, 5), row("c", 30, 0, 1)];
    expect(sortLeaderboard(rows, "tokens").map((r) => r.name)).toEqual(["c", "a", "b"]);
    expect(sortLeaderboard(rows, "tokensPerLine").map((r) => r.name)).toEqual(["c", "a", "b"]);
  });
});
