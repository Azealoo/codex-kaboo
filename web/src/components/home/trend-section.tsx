"use client";

import { bucketFor } from "@shared/days";
import { api } from "@convex/_generated/api";
import { ChartCard } from "@/components/charts/chart-card";
import { StackedBarChart, TrendChart } from "@/components/charts/trend-chart";
import { SectionCard } from "@/components/primitives/section-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useModelColors, useUserColors } from "@/hooks/use-entity-colors";
import { useStableQuery } from "@/hooks/use-stable-query";
import { trendByModel, trendByUser } from "@/lib/chart-data";
import { formatCompact } from "@shared/format";
import type { ResolvedRange } from "@/lib/range";
import { cn } from "@/lib/utils";

export function TrendSection({ range }: { range: ResolvedRange }) {
  const bucket = bucketFor(range.days);
  const { data, isStale } = useStableQuery(api.stats.trends, {
    from: range.from,
    to: range.to,
    bucket,
  });
  const userColors = useUserColors();
  const modelColors = useModelColors(data ? data.models : []);
  if (!data) {
    return (
      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title="Token usage trend">
          <Skeleton className="h-64" />
        </SectionCard>
        <SectionCard title="Tokens by model">
          <Skeleton className="h-64" />
        </SectionCard>
      </div>
    );
  }
  const byUser = trendByUser(data, userColors);
  const byModel = trendByModel(data, modelColors);
  const granularity = bucket === "day" ? "Daily" : bucket === "week" ? "Weekly" : "Monthly";
  return (
    <div className={cn("grid gap-4 xl:grid-cols-2", isStale && "opacity-60 transition-opacity")}>
      <ChartCard
        title="Token usage trend"
        description={`${granularity} tokens by user`}
        help="Stacked by user. The peak is the busiest bucket in the range."
        stacked={byUser}
        format={formatCompact}
        legendShape="line"
      >
        <TrendChart stacked={byUser} format={formatCompact} variant="area" />
      </ChartCard>
      <ChartCard
        title="Tokens by model"
        description={`${granularity} tokens, top 7 models + Other`}
        help="Stacked by model. Models beyond the top seven are folded into Other so colors stay readable."
        stacked={byModel}
        format={formatCompact}
        showPeak={false}
      >
        <StackedBarChart stacked={byModel} format={formatCompact} />
      </ChartCard>
    </div>
  );
}
