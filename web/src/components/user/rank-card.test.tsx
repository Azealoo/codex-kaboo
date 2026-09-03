import { describe, expect, it } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { LeaderboardRow } from "@convex/lib/types";
import { rankSummary } from "./rank-card";

const row = (
  id: string,
  total: number,
  rank: number,
  previousRank: number | null,
): LeaderboardRow => ({
  userId: id as Id<"users">,
  name: id,
  imageUrl: null,
  tokens: { input: total, cachedInput: 0, cacheWrite: 0, output: 0, reasoning: 0, total },
  costUsd: 0,
  unpriced: false,
  sessions: 0,
  turns: 0,
  messages: 0,
  userMessages: 0,
  linesAdded: 0,
  linesRemoved: 0,
  tokensPerLine: null,
  cacheHitRate: null,
  activeMs: 0,
  rank,
  previousRank,
  previousTokens: null,
  change: null,
});

describe("rankSummary", () => {
  it("finds the user's rank, movement, team size and token share", () => {
    const rows = [row("a", 600, 1, 2), row("b", 300, 2, 1), row("c", 100, 3, null)];
    expect(rankSummary(rows, "b" as Id<"users">)).toEqual({
      rank: 2,
      previousRank: 1,
      total: 3,
      share: 0.3,
    });
  });
  it("returns null when the user has no data in the range", () => {
    expect(rankSummary([row("a", 1, 1, null)], "zzz" as Id<"users">)).toBeNull();
  });
});
