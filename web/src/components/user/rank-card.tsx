"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { LeaderboardRow } from "@convex/lib/types";
import { RankMovement } from "@/components/primitives/rank-movement";
import { StatCard } from "@/components/primitives/stat-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useStableQuery } from "@/hooks/use-stable-query";
import { formatPercent } from "@/lib/format";
import type { ResolvedRange } from "@/lib/range";

export function rankSummary(
  rows: LeaderboardRow[],
  userId: Id<"users">,
): { rank: number; previousRank: number | null; total: number; share: number | null } | null {
  const row = rows.find((r) => r.userId === userId);
  if (!row) return null;
  const teamTokens = rows.reduce((acc, r) => acc + r.tokens.total, 0);
  return {
    rank: row.rank,
    previousRank: row.previousRank,
    total: rows.length,
    share: teamTokens > 0 ? row.tokens.total / teamTokens : null,
  };
}

export function RankCard({ range, userId }: { range: ResolvedRange; userId: Id<"users"> }) {
  const { data } = useStableQuery(api.stats.leaderboard, { from: range.from, to: range.to, previous: range.previous });
  if (!data) return <Skeleton className="h-28 rounded-lg" />;
  const summary = rankSummary(data.rows, userId);
  if (!summary) {
    return <StatCard label="Team rank" value="—" footer="No usage in this range" />;
  }
  return (
    <StatCard
      label="Team rank"
      help="Rank by total tokens in the current range; the arrow compares with the previous period."
      value={
        <span className="inline-flex items-baseline gap-2">
          #{summary.rank}
          <span className="text-base font-normal text-muted-foreground">/ {summary.total}</span>
          {range.previous ? <RankMovement rank={summary.rank} previousRank={summary.previousRank} /> : null}
        </span>
      }
      footer={summary.share === null ? undefined : `${formatPercent(summary.share)} of team tokens`}
    />
  );
}
