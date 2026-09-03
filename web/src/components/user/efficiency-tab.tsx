"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { CardsSkeleton } from "@/components/home/cards-skeleton";
import { CostStructureCard } from "@/components/home/cost-structure-card";
import { MetricStatCard } from "@/components/home/metric-stat-card";
import { modelTableColumns } from "@/components/home/model-columns";
import { DataTable } from "@/components/primitives/data-table";
import { EmptyState } from "@/components/primitives/empty-state";
import { QuerySection } from "@/components/primitives/query-section";
import { SectionErrorBoundary } from "@/components/primitives/section-error-boundary";
import { StatCard } from "@/components/primitives/stat-card";
import { useBreakdowns } from "@/hooks/use-breakdowns";
import { useStableQuery } from "@/hooks/use-stable-query";
import { modelTableRows } from "@/lib/breakdowns";
import { costPerLine, costWithoutCaching, withUnpriced } from "@/lib/efficiency";
import { formatUsd } from "@/lib/format";
import type { ResolvedRange } from "@/lib/range";
import { cn } from "@/lib/utils";

function ModelEfficiencyTable({ range, userId }: { range: ResolvedRange; userId: Id<"users"> }) {
  const { data, isStale } = useBreakdowns(range, userId);
  const columns = modelTableColumns({ usdPerMTok: true });
  return (
    <QuerySection
      title="Cost by model"
      info="Effective price per million tokens after caching. Unpriced models need a price on the Settings page."
      data={data}
      isStale={isStale}
      skeletonClassName="h-40"
    >
      {(b) =>
        b.byModel.length === 0 ? (
          <EmptyState title="No model usage in this range" />
        ) : (
          <DataTable columns={columns} rows={modelTableRows(b.byModel)} rowKey={(r) => r.model} />
        )
      }
    </QuerySection>
  );
}

function EfficiencyStats({ range, userId }: { range: ResolvedRange; userId: Id<"users"> }) {
  const { data: summary, isStale } = useStableQuery(api.stats.summary, {
    from: range.from,
    to: range.to,
    userId,
    previous: range.previous,
  });
  if (!summary)
    return <CardsSkeleton count={9} className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" />;
  // costUsd and linesAdded are sums (never null in practice); Metric.current is typed
  // `number | null` for every key, so widen back to `number` here rather than at the rate sites.
  const cost = summary.metrics.costUsd.current ?? 0;
  const perLine = costPerLine(cost, summary.metrics.linesAdded.current ?? 0);
  return (
    <div
      className={cn(
        "grid gap-4 md:grid-cols-2 xl:grid-cols-3",
        isStale && "opacity-60 transition-opacity",
      )}
    >
      <CostStructureCard
        costByKind={summary.costByKind}
        costUsd={cost}
        cacheSavingsUsd={summary.cacheSavingsUsd}
        unpricedModels={summary.unpricedModels}
      />
      <StatCard
        label="Cache savings"
        value={summary.cacheSavingsUsd}
        kind="usd"
        help="What the cached input tokens would have cost at the full input price, minus what they cost at the cached price."
        footer={withUnpriced(
          `Without caching: ${formatUsd(costWithoutCaching(cost, summary.cacheSavingsUsd))}`,
          summary.unpricedModels,
        )}
      />
      <StatCard
        label="Cost per line"
        value={perLine}
        kind="usd"
        help="Estimated cost divided by generated lines."
        footer={withUnpriced(
          perLine === null ? "No generated lines in this range" : undefined,
          summary.unpricedModels,
        )}
      />
      <MetricStatCard metricKey="cacheHitRate" metric={summary.metrics.cacheHitRate} />
      <MetricStatCard metricKey="tokensPerLine" metric={summary.metrics.tokensPerLine} />
      <MetricStatCard metricKey="tokensPerTurn" metric={summary.metrics.tokensPerTurn} />
      <MetricStatCard metricKey="ttftP50Ms" metric={summary.metrics.ttftP50Ms} />
      <MetricStatCard metricKey="compactions" metric={summary.metrics.compactions} />
      <MetricStatCard metricKey="reasoningTokens" metric={summary.metrics.reasoningTokens} />
    </div>
  );
}

export function EfficiencyTab({ range, userId }: { range: ResolvedRange; userId: Id<"users"> }) {
  return (
    <div className="flex flex-col gap-4">
      <SectionErrorBoundary title="Efficiency stats could not load">
        <EfficiencyStats range={range} userId={userId} />
      </SectionErrorBoundary>
      <SectionErrorBoundary>
        <ModelEfficiencyTable range={range} userId={userId} />
      </SectionErrorBoundary>
    </div>
  );
}
