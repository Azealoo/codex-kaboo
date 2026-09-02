"use client";

import { addDays } from "@shared/days";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ActivityHeatmap } from "@/components/charts/activity-heatmap";
import { SectionCard } from "@/components/primitives/section-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useStableQuery } from "@/hooks/use-stable-query";
import { formatCompact, formatInt } from "@/lib/format";
import { buildActivityGrid } from "@/lib/heatmap";

const DAYS_BACK = 370; // 53 weeks, aligned to Monday by the grid builder

export function ActivityCard({ userId, today }: { userId: Id<"users">; today: string }) {
  const from = addDays(today, -DAYS_BACK);
  const { data } = useStableQuery(api.stats.activityHeatmap, { userId, from, to: today });
  return (
    <SectionCard
      title="Activity"
      description={
        data
          ? `${formatInt(data.activeDays)} active days · busiest day ${formatCompact(data.maxTokens)} tokens`
          : "Last 12 months"
      }
      help="One cell per day over the last 12 months, in the day the work happened (machine time zone). Bins are fixed: under 10M, under 100M, under 1B, 1B+ tokens."
    >
      {data ? (
        <ActivityHeatmap
          grid={buildActivityGrid(from, today, data.days)}
          unpriced={data.unpricedModels.length > 0}
        />
      ) : (
        <Skeleton className="h-28" />
      )}
    </SectionCard>
  );
}
