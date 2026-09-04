import { useQuery } from "convex/react";
import { View } from "react-native";
import { addDays } from "@shared/days";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { formatCompact, formatInt, formatPercent, formatRelative } from "@shared/format";
import { formatMetricValue, USER_OVERVIEW_KEYS } from "@shared/metric-defs";
import type { ResolvedRange } from "@shared/range";
import { useNow } from "@/hooks/use-now";
import { useStableQuery } from "@/hooks/use-stable-query";
import { WEEKDAY_LABELS } from "@/lib/heatmap";
import { Breakdowns } from "./breakdowns";
import { ActivityHeatmap, DayHourHeatmap } from "./charts";
import { CostStructureCard, MetricCards } from "./overview-cards";
import { Grid2, Half } from "./screen";
import { SectionCard } from "./section-card";
import { UserTrend } from "./trend-section";
import { Badge, EmptyState, Muted, Skeleton, StatCard } from "./ui";

function RankCard({ range, userId }: { range: ResolvedRange; userId: Id<"users"> }) {
  const { data } = useStableQuery(api.stats.leaderboard, {
    from: range.from,
    to: range.to,
    previous: range.previous,
  });
  if (!data) return <Skeleton height={84} />;
  const row = data.rows.find((r) => r.userId === userId);
  if (!row) return <StatCard label="Team rank" value="—" footer="No usage in this range" />;
  const team = data.rows.reduce((acc, r) => acc + r.tokens.total, 0);
  const movement =
    row.previousRank === null
      ? "new"
      : row.previousRank === row.rank
        ? ""
        : row.previousRank > row.rank
          ? `▲ ${row.previousRank - row.rank}`
          : `▼ ${row.rank - row.previousRank}`;
  return (
    <StatCard
      label="Team rank"
      value={`#${row.rank} / ${data.rows.length}${range.previous && movement ? `  ${movement}` : ""}`}
      footer={team > 0 ? `${formatPercent(row.tokens.total / team)} of team tokens` : undefined}
    />
  );
}

function Activity({ userId, today }: { userId: Id<"users">; today: string }) {
  const from = addDays(today, -370);
  const { data } = useStableQuery(api.stats.activityHeatmap, { userId, from, to: today });
  return (
    <SectionCard
      title="Activity"
      description={
        data
          ? `${formatInt(data.activeDays)} active days · busiest day ${formatCompact(data.maxTokens)} tokens`
          : "Last 12 months"
      }
    >
      {data ? (
        <ActivityHeatmap from={from} to={today} days={data.days} />
      ) : (
        <Skeleton height={100} />
      )}
    </SectionCard>
  );
}

function TimeAnalysis({ range, userId }: { range: ResolvedRange; userId: Id<"users"> }) {
  const args = { from: range.from, to: range.to, userId };
  const { data: summary } = useStableQuery(api.stats.summary, { ...args, previous: false });
  const { data: heat } = useStableQuery(api.stats.dayHourHeatmap, args);
  if (!summary || !heat)
    return (
      <SectionCard title="Time analysis">
        <Skeleton height={160} />
      </SectionCard>
    );
  const m = summary.metrics;
  const messages = m.messages.current ?? 0;
  const sessions = m.sessions.current ?? 0;
  const rows: [string, string][] = [
    ["Total hours", formatMetricValue("hours", m.wallMs.current)],
    ["Active hours", formatMetricValue("hours", m.activeMs.current)],
    ["Active rate", formatMetricValue("percent", m.activeRate.current)],
    ["Avg session", formatMetricValue("duration", m.avgSessionActiveMs.current)],
    ["Messages / session", sessions > 0 ? (messages / sessions).toFixed(1) : "—"],
    ["Peak hour", heat.peakHour === null ? "—" : `${String(heat.peakHour).padStart(2, "0")}:00`],
    ["Most active day", heat.peakWeekday === null ? "—" : WEEKDAY_LABELS[heat.peakWeekday]!],
  ];
  return (
    <SectionCard
      title="Time analysis"
      description="When and how long this user works with Codex, in the machines' local time."
    >
      <Grid2>
        {rows.map(([label, value]) => (
          <Half key={label}>
            <StatCard label={label} value={value} />
          </Half>
        ))}
      </Grid2>
      <DayHourHeatmap grid={heat.grid} />
      {heat.zones > 1 ? (
        <Muted>
          Hours come from {heat.zones} machine timezones, so “Peak hour” is not a single wall-clock
          hour.
        </Muted>
      ) : null}
    </SectionCard>
  );
}

function Machines({ userId }: { userId: Id<"users"> }) {
  const machines = useQuery(api.machines.list, { userId });
  const now = useNow();
  return (
    <SectionCard title="Machines" description="Machines syncing for this account.">
      {machines === undefined ? (
        <Skeleton height={60} />
      ) : machines.length === 0 ? (
        <EmptyState
          title="No machines yet"
          description="Install the collector from the web dashboard's Settings page."
        />
      ) : (
        <View>
          {machines.map((m) => (
            <View
              key={m.machineId}
              style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 }}
            >
              <View style={{ flex: 1 }}>
                <Muted style={{ fontSize: 14, fontWeight: "500" }}>{m.label}</Muted>
                <Muted>
                  {m.platform}
                  {m.arch ? ` · ${m.arch}` : ""} · Codex {m.codexVersion ?? "—"} · collector{" "}
                  {m.cliVersion}
                </Muted>
              </View>
              <Badge tone="muted">synced {formatRelative(m.lastSyncAt, now)}</Badge>
            </View>
          ))}
        </View>
      )}
    </SectionCard>
  );
}

/** My Page / a teammate's page: the web's Overview + Breakdown + Efficiency tabs in one scroll. */
export function UserDashboard({
  range,
  userId,
  today,
}: {
  range: ResolvedRange;
  userId: Id<"users">;
  today: string;
}) {
  return (
    <>
      <Grid2>
        <Half>
          <RankCard range={range} userId={userId} />
        </Half>
      </Grid2>
      <MetricCards range={range} userId={userId} keys={USER_OVERVIEW_KEYS} />
      <Activity userId={userId} today={today} />
      <UserTrend range={range} userId={userId} />
      <CostStructureCard range={range} userId={userId} />
      <Breakdowns range={range} userId={userId} />
      <TimeAnalysis range={range} userId={userId} />
      <Machines userId={userId} />
    </>
  );
}
