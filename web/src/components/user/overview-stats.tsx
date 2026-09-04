"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { CardsSkeleton } from "@/components/home/cards-skeleton";
import { MetricStatCard } from "@/components/home/metric-stat-card";
import { StaleRollupsNotice } from "@/components/primitives/stale-rollups-notice";
import { useStableQuery } from "@/hooks/use-stable-query";
import { USER_OVERVIEW_KEYS } from "@/lib/metrics";
import type { ResolvedRange } from "@/lib/range";
import { cn } from "@/lib/utils";
import { RankCard } from "./rank-card";

const GRID = "grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7";

export function OverviewStats({ range, userId }: { range: ResolvedRange; userId: Id<"users"> }) {
  const { data: summary, isStale } = useStableQuery(api.stats.summary, {
    from: range.from,
    to: range.to,
    userId,
    previous: range.previous,
  });
  if (!summary) return <CardsSkeleton count={14} className={GRID} />;
  return (
    <>
      <StaleRollupsNotice days={summary.staleRollupDays} className="mb-3" />
      <div className={cn(GRID, isStale && "opacity-60 transition-opacity")}>
        <RankCard range={range} userId={userId} />
        {USER_OVERVIEW_KEYS.map((key) => (
          <MetricStatCard
            key={key}
            metricKey={key}
            metric={summary.metrics[key]}
            size="sm"
            badge={key === "costUsd" ? "API list price" : undefined}
          />
        ))}
      </div>
    </>
  );
}
