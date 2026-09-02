"use client";

import { useState } from "react";
import { bucketFor, type Bucket } from "@shared/days";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ChartCard } from "@/components/charts/chart-card";
import { TrendChart, type TrendVariant } from "@/components/charts/trend-chart";
import { SectionCard } from "@/components/primitives/section-card";
import { SegmentedControl } from "@/components/primitives/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { useStableQuery } from "@/hooks/use-stable-query";
import { trendSingle, unpricedFooter, type TrendMetric } from "@/lib/chart-data";
import { CATEGORICAL } from "@/lib/colors";
import { formatCompact, formatUsd } from "@/lib/format";
import type { ResolvedRange } from "@/lib/range";

const METRICS = [
  { value: "tokens", label: "Tokens" },
  { value: "cost", label: "Cost" },
  { value: "hours", label: "Hours" },
] as const;
const VARIANTS = [
  { value: "area", label: "Line" },
  { value: "bars", label: "Bars" },
  { value: "both", label: "Both" },
] as const;
const BUCKETS = [
  { value: "day", label: "Daily" },
  { value: "week", label: "Weekly" },
  { value: "month", label: "Monthly" },
] as const;

const formatHoursValue = (v: number) => `${v.toFixed(1)}h`;

export function TokenTrendCard({ range, userId }: { range: ResolvedRange; userId: Id<"users"> }) {
  const [metric, setMetric] = useState<TrendMetric>("tokens");
  const [variant, setVariant] = useState<TrendVariant>("area");
  const [bucket, setBucket] = useState<Bucket | null>(null);
  const effectiveBucket = bucket ?? bucketFor(range.days);
  const { data } = useStableQuery(api.stats.trends, { from: range.from, to: range.to, bucket: effectiveBucket, userId });
  const format = metric === "cost" ? formatUsd : metric === "hours" ? formatHoursValue : formatCompact;
  const actions = (
    <>
      <SegmentedControl ariaLabel="Trend metric" options={METRICS} value={metric} onChange={setMetric} />
      <SegmentedControl ariaLabel="Chart style" options={VARIANTS} value={variant} onChange={setVariant} />
      <SegmentedControl ariaLabel="Granularity" options={BUCKETS} value={effectiveBucket} onChange={setBucket} />
    </>
  );
  if (!data) {
    return (
      <SectionCard title="Token trend" actions={actions}>
        <Skeleton className="h-64" />
      </SectionCard>
    );
  }
  const stacked = trendSingle(data, metric, CATEGORICAL[0]);
  const footerText = unpricedFooter(metric, data.unpricedModels);
  const footer = footerText ? <p className="text-xs text-muted-foreground">{footerText}</p> : undefined;
  return (
    <ChartCard title="Token trend" stacked={stacked} format={format} actions={actions} legendShape="line" footer={footer}>
      <TrendChart stacked={stacked} format={format} variant={variant} />
    </ChartCard>
  );
}
