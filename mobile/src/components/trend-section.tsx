import { useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { View } from "react-native";
import { bucketFor, type Bucket } from "@shared/days";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { formatCompact, formatUsd } from "@shared/format";
import type { ResolvedRange } from "@shared/range";
import { useStableQuery } from "@/hooks/use-stable-query";
import { stackByModel, stackByUser, stackSingle, type SingleMetric } from "@/lib/chart";
import { modelColorMap } from "@/lib/colors";
import { CATEGORICAL } from "@/lib/theme";
import { Legend, StackedBars } from "./charts";
import { useUserColors } from "./leaderboard";
import { SectionCard } from "./section-card";
import { Badge, EmptyState, SegmentedControl, Skeleton } from "./ui";

export function useModelColors(seen: readonly string[]) {
  const prices = useQuery(api.prices.list, {});
  const key = seen.join(" ");
  return useMemo(
    () =>
      modelColorMap(
        (prices ?? []).map((p) => p.model),
        key === "" ? [] : key.split(" "),
      ),
    [prices, key],
  );
}

const granularityLabel = (b: Bucket) =>
  b === "day" ? "Daily" : b === "week" ? "Weekly" : "Monthly";

export function TeamTrends({ range }: { range: ResolvedRange }) {
  const bucket = bucketFor(range.days);
  const { data, isStale } = useStableQuery(api.stats.trends, {
    from: range.from,
    to: range.to,
    bucket,
  });
  const userColors = useUserColors();
  const modelColors = useModelColors(data ? data.models : []);
  if (!data)
    return (
      <>
        <SectionCard title="Token usage trend">
          <Skeleton height={180} />
        </SectionCard>
        <SectionCard title="Tokens by model">
          <Skeleton height={180} />
        </SectionCard>
      </>
    );
  const byUser = stackByUser(data, userColors);
  const byModel = stackByModel(data, modelColors);
  return (
    <View style={{ gap: 12, opacity: isStale ? 0.6 : 1 }}>
      <SectionCard
        title="Token usage trend"
        description={`${granularityLabel(bucket)} tokens by user`}
        actions={
          byUser.peak ? (
            <Badge>
              Peak {formatCompact(byUser.peak.total)} · {byUser.peak.label}
            </Badge>
          ) : undefined
        }
      >
        {byUser.bars.length === 0 ? (
          <EmptyState title="No data in this range" />
        ) : (
          <StackedBars data={byUser} />
        )}
        <Legend series={byUser.series} />
      </SectionCard>
      <SectionCard
        title="Tokens by model"
        description={`${granularityLabel(bucket)} tokens, top 5 models + Other`}
      >
        {byModel.bars.length === 0 ? (
          <EmptyState title="No data in this range" />
        ) : (
          <StackedBars data={byModel} />
        )}
        <Legend series={byModel.series} />
      </SectionCard>
    </View>
  );
}

const METRICS = [
  { value: "tokens", label: "Tokens" },
  { value: "cost", label: "Cost" },
  { value: "hours", label: "Hours" },
] as const;
const BUCKETS = [
  { value: "day", label: "Daily" },
  { value: "week", label: "Weekly" },
  { value: "month", label: "Monthly" },
] as const;

export function UserTrend({ range, userId }: { range: ResolvedRange; userId: Id<"users"> }) {
  const [metric, setMetric] = useState<SingleMetric>("tokens");
  const [bucket, setBucket] = useState<Bucket | null>(null);
  const effective = bucket ?? bucketFor(range.days);
  const { data, isStale } = useStableQuery(api.stats.trends, {
    from: range.from,
    to: range.to,
    bucket: effective,
    userId,
  });
  const format =
    metric === "cost"
      ? formatUsd
      : metric === "hours"
        ? (v: number) => `${v.toFixed(1)}h`
        : formatCompact;
  const actions = (
    <>
      <SegmentedControl
        label="Trend metric"
        options={METRICS}
        value={metric}
        onChange={setMetric}
      />
      <SegmentedControl
        label="Granularity"
        options={BUCKETS}
        value={effective}
        onChange={setBucket}
      />
    </>
  );
  if (!data)
    return (
      <SectionCard title="Token trend" actions={actions}>
        <Skeleton height={180} />
      </SectionCard>
    );
  const stacked = stackSingle(data, metric, CATEGORICAL[0]);
  return (
    <SectionCard
      title="Token trend"
      actions={actions}
      description={
        metric === "cost" && data.unpricedModels.length > 0
          ? `Unpriced: ${data.unpricedModels.join(", ")}`
          : undefined
      }
    >
      <View style={{ opacity: isStale ? 0.6 : 1 }}>
        {stacked.bars.length === 0 ? (
          <EmptyState title="No data in this range" />
        ) : (
          <StackedBars data={stacked} format={format} />
        )}
      </View>
    </SectionCard>
  );
}
