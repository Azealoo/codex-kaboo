import { useQuery } from "convex/react";
import { View } from "react-native";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { formatRelative, formatResetsIn, formatUsd } from "@shared/format";
import {
  EFFICIENCY_CARD_KEYS,
  METRIC_DEFS,
  VOLUME_CARD_KEYS,
  type MetricKey,
} from "@shared/metric-defs";
import type { ResolvedRange } from "@shared/range";
import { useNow } from "@/hooks/use-now";
import { useStableQuery } from "@/hooks/use-stable-query";
import { CATEGORICAL } from "@/lib/theme";
import { Grid2, Half } from "./screen";
import { QuotaArc, ShareBar, Sparkline } from "./charts";
import { Badge, Card, EmptyState, Muted, Skeleton, StatCard, Title } from "./ui";

export function MetricCards({
  range,
  userId,
  keys,
}: {
  range: ResolvedRange;
  userId?: Id<"users">;
  keys: readonly MetricKey[];
}) {
  const { data, isStale } = useStableQuery(api.stats.summary, {
    from: range.from,
    to: range.to,
    userId,
    previous: range.previous,
  });
  if (!data)
    return (
      <Grid2>
        {keys.map((k) => (
          <Half key={k}>
            <Skeleton height={84} />
          </Half>
        ))}
      </Grid2>
    );
  return (
    <View style={{ opacity: isStale ? 0.6 : 1, gap: 8 }}>
      <Grid2>
        {keys.map((key) => {
          const def = METRIC_DEFS[key];
          const m = data.metrics[key];
          return (
            <Half key={key}>
              <StatCard
                label={def.label}
                value={m.current}
                kind={def.kind}
                change={m.previous === null ? null : m.change}
                goodDirection={def.goodDirection}
                badge={key === "costUsd" ? "API list price" : undefined}
                footer={
                  key === "costUsd" && data.unpricedModels.length > 0
                    ? `Unpriced: ${data.unpricedModels.join(", ")}`
                    : undefined
                }
              />
            </Half>
          );
        })}
      </Grid2>
    </View>
  );
}

export { EFFICIENCY_CARD_KEYS, VOLUME_CARD_KEYS };

export function CostStructureCard({
  range,
  userId,
}: {
  range: ResolvedRange;
  userId?: Id<"users">;
}) {
  const { data } = useStableQuery(api.stats.summary, {
    from: range.from,
    to: range.to,
    userId,
    previous: false,
  });
  if (!data) return <Skeleton height={120} />;
  const c = data.costByKind;
  const total = c.input + c.cached + c.output + c.reasoning;
  const seg = (key: string, label: string, value: number, color: string) => ({
    key,
    label,
    value,
    share: total > 0 ? value / total : 0,
    color,
  });
  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Title>Cost structure</Title>
        <Title>{formatUsd(data.metrics.costUsd.current ?? 0)}</Title>
      </View>
      <ShareBar
        segments={[
          seg("input", "Input", c.input, CATEGORICAL[1]),
          seg("cached", "Cached input", c.cached, CATEGORICAL[0]),
          seg("output", "Output", c.output, CATEGORICAL[2]),
          seg("reasoning", "Reasoning", c.reasoning, CATEGORICAL[6]),
        ]}
        format={formatUsd}
      />
      <Muted>Cache savings {formatUsd(data.cacheSavingsUsd)} vs. no caching</Muted>
      {data.unpricedModels.length > 0 ? (
        <Muted>Unpriced: {data.unpricedModels.join(", ")}</Muted>
      ) : null}
    </Card>
  );
}

const STALE_AFTER_MS = 2 * 3_600_000;
const DAY = 86_400_000;

export function QuotaCard() {
  const quota = useQuery(api.stats.quota, {});
  const now = useNow();
  const since = Math.floor(now / 3_600_000) * 3_600_000 - 7 * DAY;
  const history = useQuery(api.stats.quotaHistory, { sinceMs: since });
  if (quota === undefined) return <Skeleton height={160} />;
  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Title style={{ flex: 1 }}>Shared weekly quota</Title>
        {quota && now - quota.receivedAt > STALE_AFTER_MS ? (
          <Badge tone="warning">Stale</Badge>
        ) : null}
      </View>
      {quota === null ? (
        <EmptyState
          title="No quota data yet"
          description="Appears after the first sync from any machine."
        />
      ) : (
        <>
          <QuotaArc usedPercent={quota.usedPercent} />
          <Muted>
            {formatResetsIn(quota.resetsAt, now)} · {quota.planType ?? "unknown plan"}
          </Muted>
          <Muted>
            as of {formatRelative(quota.receivedAt, now)} · {quota.machine.label} ({quota.user.name}
            )
          </Muted>
          {history && history.points.length > 0 ? (
            <View style={{ gap: 4, marginTop: 4 }}>
              <Sparkline points={history.points} from={since} to={now} />
              <Muted>Last 7 days · {history.points.length} readings</Muted>
            </View>
          ) : null}
        </>
      )}
    </Card>
  );
}
