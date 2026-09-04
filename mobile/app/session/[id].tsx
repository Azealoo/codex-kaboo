import { useQuery } from "convex/react";
import { Stack, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { api } from "@convex/_generated/api";
import { TOOL_KINDS } from "@shared/constants";
import {
  formatCompact,
  formatDateTime,
  formatDurationMs,
  formatInt,
  formatPercent,
  formatUsd,
} from "@shared/format";
import { sourceLabel, TOOL_LABELS } from "@/components/breakdowns";
import { ShareBar } from "@/components/charts";
import { Grid2, Half, Screen } from "@/components/screen";
import { SectionCard } from "@/components/section-card";
import { Badge, EmptyState, KeyValue, Muted, Skeleton, StatCard } from "@/components/ui";
import { CATEGORICAL } from "@/lib/theme";

export default function SessionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const s = useQuery(api.sessions.get, { sessionId: id ?? "" });
  if (s === undefined)
    return (
      <Screen>
        <Skeleton height={200} />
      </Screen>
    );
  if (s === null)
    return (
      <Screen>
        <EmptyState title="Session not found" />
      </Screen>
    );
  const t = s.tokens;
  const uncached = Math.max(0, t.input - t.cachedInput);
  const reasoning = Math.min(t.reasoning, t.output);
  const plain = Math.max(0, t.output - reasoning);
  const total = uncached + t.cachedInput + plain + reasoning;
  const seg = (key: string, label: string, value: number, color: string) => ({
    key,
    label,
    value,
    share: total > 0 ? value / total : 0,
    color,
  });
  const tools = TOOL_KINDS.filter((k) => s.toolCounts[k] > 0).sort(
    (a, b) => s.toolCounts[b] - s.toolCounts[a],
  );
  const cells: [string, string][] = [
    ["Model", s.model],
    ["Effort", s.effort ?? "—"],
    ["Est. cost", s.costUsd === null ? "unpriced" : formatUsd(s.costUsd)],
    ["Tokens", formatCompact(t.total)],
    ["Cache hit", formatPercent(s.cacheHitRate)],
    ["Responses", formatInt(s.responses)],
    ["Turns", `${formatInt(s.completedTurns)} / ${formatInt(s.turns)}`],
    ["Messages", `${formatInt(s.userMessages)} you · ${formatInt(s.agentMessages)} agent`],
    ["Active time", formatDurationMs(s.activeMs)],
    ["Wall time", formatDurationMs(s.wallMs)],
    ["TTFT mean", s.ttftAvgMs === null ? "—" : formatDurationMs(s.ttftAvgMs)],
    ["Lines", `+${formatInt(s.linesAdded)} / −${formatInt(s.linesRemoved)}`],
    ["Files changed", formatInt(s.filesChanged)],
    ["Compactions", formatInt(s.compactions)],
  ];
  return (
    <>
      <Stack.Screen options={{ title: s.project }} />
      <Screen>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
          <Badge>{sourceLabel(s.source, s.isSubagent)}</Badge>
          {s.inProgress ? <Badge tone="good">In progress</Badge> : null}
          <Muted>
            {formatDateTime(s.startedAt)}
            {s.gitBranch ? ` · ${s.gitBranch}` : ""} · {s.userName} · {s.machineLabel}
          </Muted>
        </View>
        <Grid2>
          {cells.map(([label, value]) => (
            <Half key={label}>
              <StatCard label={label} value={value} />
            </Half>
          ))}
        </Grid2>
        <SectionCard title="Token structure">
          <ShareBar
            segments={[
              seg("input", "Uncached input", uncached, CATEGORICAL[1]),
              seg("cached", "Cached input", t.cachedInput, CATEGORICAL[0]),
              seg("output", "Output", plain, CATEGORICAL[2]),
              seg("reasoning", "Reasoning", reasoning, CATEGORICAL[6]),
            ]}
          />
        </SectionCard>
        {tools.length > 0 || s.mcpTools.length > 0 || s.skills.length > 0 ? (
          <SectionCard title="Tools and skills">
            {tools.map((k) => (
              <KeyValue key={k} label={TOOL_LABELS[k]} value={formatInt(s.toolCounts[k])} />
            ))}
            {s.mcpTools.map((m) => (
              <KeyValue key={`mcp-${m.key}`} label={`MCP · ${m.key}`} value={formatInt(m.count)} />
            ))}
            {s.skills.map((sk) => (
              <KeyValue
                key={`skill-${sk.key}`}
                label={`Skill · ${sk.key}`}
                value={formatInt(sk.count)}
              />
            ))}
          </SectionCard>
        ) : null}
        <SectionCard title="Details">
          <KeyValue label="Started via" value={s.originator} />
          <KeyValue label="Codex" value={s.cliVersion ?? "—"} />
          <KeyValue label="Time zone" value={s.timezone ?? "—"} />
          <Muted numberOfLines={2}>
            Thread {s.sessionId}
            {s.parentThreadId ? ` (parent ${s.parentThreadId})` : ""}
          </Muted>
        </SectionCard>
      </Screen>
    </>
  );
}
