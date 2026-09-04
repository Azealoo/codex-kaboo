import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "convex/react";
import { Link } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { api } from "@convex/_generated/api";
import type { LeaderboardRow } from "@convex/lib/types";
import { formatDeltaPercent, formatPercent } from "@shared/format";
import { formatMetricValue, type MetricKind } from "@shared/metric-defs";
import type { ResolvedRange } from "@shared/range";
import { useStableQuery } from "@/hooks/use-stable-query";
import { colorFor, userColorMap } from "@/lib/colors";
import { usePalette } from "@/providers/theme";
import { SectionCard } from "./section-card";
import { Avatar } from "./avatar";
import { DeltaPill, EmptyState, Muted, SegmentedControl, Skeleton } from "./ui";

type Metric = "tokens" | "cost" | "sessions" | "messages" | "lines";
const METRICS: { value: Metric; label: string; kind: MetricKind }[] = [
  { value: "tokens", label: "Tokens", kind: "tokens" },
  { value: "cost", label: "Cost", kind: "usd" },
  { value: "sessions", label: "Sessions", kind: "count" },
  { value: "messages", label: "Messages", kind: "count" },
  { value: "lines", label: "Lines", kind: "count" },
];

function valueOf(r: LeaderboardRow, m: Metric): number {
  switch (m) {
    case "tokens":
      return r.tokens.total;
    case "cost":
      return r.costUsd;
    case "sessions":
      return r.sessions;
    case "messages":
      return r.messages;
    case "lines":
      return r.linesAdded;
  }
}

export function useUserColors() {
  const users = useQuery(api.users.list, {});
  return useMemo(() => userColorMap((users ?? []).map((u) => u.userId as string)), [users]);
}

export function Leaderboard({ range }: { range: ResolvedRange }) {
  const p = usePalette();
  const { data, isStale } = useStableQuery(api.stats.leaderboard, {
    from: range.from,
    to: range.to,
    previous: range.previous,
  });
  const colors = useUserColors();
  const [metric, setMetric] = useState<Metric>("tokens");
  const def = METRICS.find((m) => m.value === metric)!;
  const rows = data
    ? [...data.rows].sort(
        (a, b) => valueOf(b, metric) - valueOf(a, metric) || a.name.localeCompare(b.name),
      )
    : [];
  const max = rows.reduce((m, r) => Math.max(m, valueOf(r, metric)), 0);
  return (
    <SectionCard
      title="Users"
      actions={
        <SegmentedControl
          label="Ranking metric"
          options={METRICS}
          value={metric}
          onChange={setMetric}
        />
      }
    >
      {!data ? (
        <Skeleton height={160} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No usage in this range"
          description="Install the collector on a machine or widen the range."
        />
      ) : (
        <View style={{ gap: 4, opacity: isStale ? 0.6 : 1 }}>
          {rows.map((r, i) => {
            const v = valueOf(r, metric);
            const color = colorFor(colors, r.userId);
            return (
              <Link
                key={r.userId}
                href={{ pathname: "/user/[id]", params: { id: r.userId } }}
                asChild
              >
                <Pressable
                  accessibilityRole="link"
                  style={({ pressed }) => ({
                    paddingVertical: 8,
                    gap: 6,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <Text
                      style={{
                        width: 20,
                        color: p.mutedForeground,
                        fontVariant: ["tabular-nums"],
                        fontSize: 13,
                      }}
                    >
                      {i + 1}
                    </Text>
                    <Avatar name={r.name} imageUrl={r.imageUrl} color={color} size={28} />
                    <Text
                      numberOfLines={1}
                      style={{ flex: 1, color: p.foreground, fontSize: 14, fontWeight: "500" }}
                    >
                      {r.name}
                    </Text>
                    {metric === "tokens" && range.previous ? (
                      <DeltaPill change={r.change} goodDirection="up" />
                    ) : null}
                    <Text
                      style={{
                        color: p.foreground,
                        fontSize: 14,
                        fontWeight: "600",
                        fontVariant: ["tabular-nums"],
                      }}
                    >
                      {metric === "cost" && r.unpriced ? "≈ " : ""}
                      {formatMetricValue(def.kind, v)}
                    </Text>
                    <Ionicons name="chevron-forward" size={14} color={p.mutedForeground} />
                  </View>
                  <View
                    style={{
                      marginLeft: 30,
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: p.muted,
                      overflow: "hidden",
                    }}
                  >
                    <View
                      style={{
                        width: `${max > 0 ? (v / max) * 100 : 0}%`,
                        height: "100%",
                        backgroundColor: color,
                      }}
                    />
                  </View>
                  <View style={{ marginLeft: 30, flexDirection: "row", gap: 12 }}>
                    <Muted>Cache hit {formatPercent(r.cacheHitRate)}</Muted>
                    <Muted>Active {formatMetricValue("hours", r.activeMs)}</Muted>
                    {metric === "tokens" && r.previousRank !== null && r.previousRank !== r.rank ? (
                      <Muted>
                        {r.previousRank > r.rank ? "▲" : "▼"} from #{r.previousRank}
                      </Muted>
                    ) : null}
                    {metric === "tokens" && r.change !== null ? (
                      <Muted>{formatDeltaPercent(r.change)} vs previous</Muted>
                    ) : null}
                  </View>
                </Pressable>
              </Link>
            );
          })}
        </View>
      )}
    </SectionCard>
  );
}
