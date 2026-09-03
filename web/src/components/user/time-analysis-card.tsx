"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { DayHourHeatmap } from "@/components/charts/day-hour-heatmap";
import { InfoTooltip } from "@/components/primitives/info-tooltip";
import { SectionCard } from "@/components/primitives/section-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useBreakdowns } from "@/hooks/use-breakdowns";
import { useStableQuery } from "@/hooks/use-stable-query";
import { formatCompact } from "@/lib/format";
import type { ResolvedRange } from "@/lib/range";
import { timeAnalysisRows } from "@/lib/time-analysis";

export function TimeAnalysisCard({ range, userId }: { range: ResolvedRange; userId: Id<"users"> }) {
  const args = { from: range.from, to: range.to, userId };
  const { data: summary } = useStableQuery(api.stats.summary, { ...args, previous: false });
  const { data: breakdowns } = useBreakdowns(range, userId);
  const { data: heatmap } = useStableQuery(api.stats.dayHourHeatmap, args);
  return (
    <SectionCard
      title="Time analysis"
      help="When and how long this user works with Codex, in the machines' local time."
      bodyClassName="flex flex-col gap-4"
    >
      {!summary || !breakdowns || !heatmap ? (
        <Skeleton className="h-48" />
      ) : (
        <>
          <dl className="grid gap-3 sm:grid-cols-3 lg:grid-cols-7">
            {timeAnalysisRows(summary, breakdowns.byHour, heatmap).map((row) => (
              <div key={row.label} className="rounded-lg border border-border p-3">
                <dt className="flex items-center gap-1 text-xs text-muted-foreground">
                  {row.label}
                  <InfoTooltip text={row.help} />
                </dt>
                <dd className="text-lg font-semibold">{row.value}</dd>
              </div>
            ))}
          </dl>
          <DayHourHeatmap grid={heatmap.grid} format={formatCompact} />
        </>
      )}
    </SectionCard>
  );
}
