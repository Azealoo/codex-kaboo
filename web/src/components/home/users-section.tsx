"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { LeaderboardRow } from "@convex/lib/types";
import { AvatarName } from "@/components/primitives/avatar-name";
import type { BarScale } from "@/components/primitives/bar-cell";
import { DataTable, type Column } from "@/components/primitives/data-table";
import { DeltaPill } from "@/components/primitives/delta-pill";
import { EmptyState } from "@/components/primitives/empty-state";
import { Podium, type PodiumEntry } from "@/components/primitives/podium";
import { RankMovement } from "@/components/primitives/rank-movement";
import { SectionCard } from "@/components/primitives/section-card";
import { SegmentedControl } from "@/components/primitives/segmented-control";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useUserColors } from "@/hooks/use-entity-colors";
import { useRangeHref } from "@/hooks/use-range";
import { useStableQuery } from "@/hooks/use-stable-query";
import { colorFor } from "@/lib/colors";
import { csvFilename } from "@/lib/csv";
import { formatDeltaPercent } from "@/lib/format";
import {
  LEADER_METRICS,
  leaderKind,
  leaderValue,
  sortLeaderboard,
  type LeaderMetric,
} from "@/lib/leaderboard";
import { formatMetricValue } from "@/lib/metrics";
import type { ResolvedRange } from "@/lib/range";
import { cn } from "@/lib/utils";

const SCALES: { value: BarScale; label: string }[] = [
  { value: "linear", label: "Linear" },
  { value: "log", label: "Log" },
];

export function UsersSection({ range }: { range: ResolvedRange }) {
  const { data, isStale } = useStableQuery(api.stats.leaderboard, {
    from: range.from,
    to: range.to,
    previous: range.previous,
  });
  const colors = useUserColors();
  const href = useRangeHref();
  const [metric, setMetric] = useState<LeaderMetric>("tokens");
  const [scale, setScale] = useState<BarScale>("linear");
  const kind = leaderKind(metric);

  const actions = (
    <>
      <SegmentedControl
        ariaLabel="Ranking metric"
        options={LEADER_METRICS}
        value={metric}
        onChange={setMetric}
      />
      <SegmentedControl ariaLabel="Bar scale" options={SCALES} value={scale} onChange={setScale} />
    </>
  );

  if (!data) {
    return (
      <SectionCard title="Users" actions={actions}>
        <Skeleton className="h-64" />
      </SectionCard>
    );
  }

  const rows = sortLeaderboard(data.rows, metric);
  const podium: PodiumEntry[] = rows.slice(0, 3).map((r, i) => ({
    rank: (i + 1) as 1 | 2 | 3,
    name: r.name,
    imageUrl: r.imageUrl,
    color: colorFor(colors, r.userId),
    value: formatMetricValue(kind, leaderValue(r, metric)),
    sub:
      metric === "tokens" && r.change !== null
        ? `${formatDeltaPercent(r.change)} vs previous`
        : undefined,
    href: href(`/users/${r.userId}`),
  }));

  const columns: Column<LeaderboardRow>[] = [
    {
      key: "rank",
      header: "#",
      width: "4rem",
      render: (r) => (
        <span className="inline-flex items-center gap-2 tabular">
          {rows.indexOf(r) + 1}
          {metric === "tokens" && range.previous ? (
            <RankMovement rank={r.rank} previousRank={r.previousRank} />
          ) : null}
        </span>
      ),
    },
    {
      key: "user",
      header: "User",
      csv: (r) => r.name,
      render: (r) => (
        <Link href={href(`/users/${r.userId}`)} className="hover:underline">
          <AvatarName name={r.name} imageUrl={r.imageUrl} color={colorFor(colors, r.userId)} />
        </Link>
      ),
    },
    {
      key: "metric",
      header: LEADER_METRICS.find((m) => m.value === metric)!.label,
      align: "right",
      csv: (r) => leaderValue(r, metric),
      bar: (r) => leaderValue(r, metric) ?? 0,
      render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          {metric === "cost" && r.unpriced ? (
            <Badge variant="outline" className="rounded-full text-[10px]">
              unpriced
            </Badge>
          ) : null}
          {formatMetricValue(kind, leaderValue(r, metric))}
        </span>
      ),
    },
    {
      key: "cache",
      header: "Cache hit",
      align: "right",
      hideBelow: "md",
      csv: (r) => r.cacheHitRate,
      render: (r) => formatMetricValue("percent", r.cacheHitRate),
    },
    {
      key: "active",
      header: "Active",
      align: "right",
      hideBelow: "md",
      csv: (r) => r.activeMs / 3_600_000,
      render: (r) => formatMetricValue("hours", r.activeMs),
    },
    {
      key: "delta",
      header: "vs previous",
      align: "right",
      csv: (r) => (metric === "tokens" ? r.change : null),
      render: (r) =>
        metric === "tokens" ? <DeltaPill change={r.change} goodDirection="up" /> : null,
    },
  ];

  return (
    <SectionCard
      title="Users"
      help="Ranked by the selected metric for the current range. Rank movement and the delta compare token totals with the previous period of the same length."
      actions={actions}
      bodyClassName={cn("flex flex-col gap-6", isStale && "opacity-60 transition-opacity")}
    >
      {rows.length === 0 ? (
        <EmptyState
          title="No usage in this range"
          description="Install the collector on a machine or widen the range."
        />
      ) : (
        <>
          <Podium entries={podium} />
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.userId}
            scale={scale}
            barColor={(r) => colorFor(colors, r.userId)}
            exportFilename={csvFilename("users", range)}
          />
        </>
      )}
    </SectionCard>
  );
}
