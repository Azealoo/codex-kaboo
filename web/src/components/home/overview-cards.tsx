"use client";

import { api } from "@convex/_generated/api";
import { useStableQuery } from "@/hooks/use-stable-query";
import { EFFICIENCY_CARD_KEYS, VOLUME_CARD_KEYS } from "@/lib/metrics";
import type { ResolvedRange } from "@/lib/range";
import type { View } from "@/lib/search-params";
import { cn } from "@/lib/utils";
import { CardsSkeleton } from "./cards-skeleton";
import { CostStructureCard } from "./cost-structure-card";
import { MetricStatCard } from "./metric-stat-card";
import { QuotaCard } from "./quota-card";

export function OverviewCards({ range, view }: { range: ResolvedRange; view: View }) {
  const { data: summary, isStale } = useStableQuery(api.stats.summary, {
    from: range.from,
    to: range.to,
    previous: range.previous,
  });
  const grid = view === "volume" ? "grid gap-4 md:grid-cols-2 xl:grid-cols-5" : "grid gap-4 md:grid-cols-2 xl:grid-cols-3";
  if (!summary) return <CardsSkeleton count={view === "volume" ? 5 : 6} className={grid} />;
  const keys = view === "volume" ? VOLUME_CARD_KEYS : EFFICIENCY_CARD_KEYS;
  return (
    <div className={cn(grid, isStale && "opacity-60 transition-opacity")}>
      {keys.map((key) => (
        <MetricStatCard
          key={key}
          metricKey={key}
          metric={summary.metrics[key]}
          badge={key === "costUsd" ? "API list price" : undefined}
          footer={
            key === "costUsd" && summary.unpricedModels.length > 0
              ? `Unpriced: ${summary.unpricedModels.join(", ")}`
              : undefined
          }
        />
      ))}
      {view === "volume" ? (
        <QuotaCard />
      ) : (
        <CostStructureCard
          costByKind={summary.costByKind}
          costUsd={summary.metrics.costUsd.current}
          cacheSavingsUsd={summary.cacheSavingsUsd}
          unpricedModels={summary.unpricedModels}
        />
      )}
    </div>
  );
}
