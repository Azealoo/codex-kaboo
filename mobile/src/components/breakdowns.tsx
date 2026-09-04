import { useState } from "react";
import { View } from "react-native";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { BreakdownsResult } from "@convex/lib/types";
import { TOOL_KINDS, type ToolKind } from "@shared/constants";
import { formatCompact, formatInt, formatPercent, formatUsd } from "@shared/format";
import type { ResolvedRange } from "@shared/range";
import { useStableQuery } from "@/hooks/use-stable-query";
import { shareSegments } from "@/lib/chart";
import { colorFor, OTHER_COLOR } from "@/lib/colors";
import { CATEGORICAL } from "@/lib/theme";
import { ShareBar } from "./charts";
import { SectionCard } from "./section-card";
import { useModelColors } from "./trend-section";
import { EmptyState, KeyValue, Muted, SegmentedControl, Skeleton } from "./ui";

export const TOOL_LABELS: Record<ToolKind, string> = {
  commandRead: "Read files",
  commandList: "List files",
  commandSearch: "Search",
  commandOther: "Other commands",
  fileChange: "File changes",
  webSearch: "Web search",
  imageView: "Image view",
  mcpTool: "MCP tools",
  other: "Other",
};
const TOOL_COLORS: Record<ToolKind, string> = {
  commandRead: CATEGORICAL[1],
  commandList: CATEGORICAL[3],
  commandSearch: CATEGORICAL[4],
  commandOther: CATEGORICAL[5],
  fileChange: CATEGORICAL[0],
  webSearch: CATEGORICAL[2],
  imageView: CATEGORICAL[7],
  mcpTool: CATEGORICAL[6],
  other: OTHER_COLOR,
};
export const SOURCE_LABELS: Record<string, string> = {
  cli: "CLI",
  exec: "Exec",
  vscode: "VS Code",
  mcp: "MCP",
};
export function sourceLabel(source: string, isSubagent = false): string {
  if (source.startsWith("subagent:")) {
    const kind = source.slice("subagent:".length);
    return kind ? `Sub-agent · ${kind}` : "Sub-agent";
  }
  if (isSubagent) return "Sub-agent";
  return SOURCE_LABELS[source] ?? source;
}

type Section = "models" | "tools" | "projects" | "skills" | "machines" | "sources";
const SECTIONS: { value: Section; label: string }[] = [
  { value: "models", label: "Models" },
  { value: "tools", label: "Tools" },
  { value: "projects", label: "Projects" },
  { value: "skills", label: "Skills" },
  { value: "machines", label: "Machines" },
  { value: "sources", label: "Sources" },
];

function Body({ b, section }: { b: BreakdownsResult; section: Section }) {
  const modelColors = useModelColors(b.byModel.map((m) => m.key));
  switch (section) {
    case "models": {
      if (b.byModel.length === 0) return <EmptyState title="No model usage in this range" />;
      const segments = shareSegments(
        b.byModel.map((m) => ({ key: m.key, value: m.tokens.total })),
        (k) => colorFor(modelColors, k),
      );
      return (
        <View style={{ gap: 8 }}>
          <ShareBar segments={segments} />
          {b.byModel.map((m) => (
            <KeyValue
              key={m.key}
              label={m.key}
              value={formatCompact(m.tokens.total)}
              sub={`${formatPercent(m.share)} · ${m.costUsd === null ? "unpriced" : formatUsd(m.costUsd)} · cache ${formatPercent(m.tokens.input > 0 ? m.tokens.cachedInput / m.tokens.input : null)}`}
              color={colorFor(modelColors, m.key)}
            />
          ))}
          {b.byEffort.length > 0 ? (
            <>
              <Muted style={{ marginTop: 6 }}>By reasoning effort</Muted>
              {b.byEffort.map((e) => (
                <KeyValue
                  key={e.key}
                  label={e.key}
                  value={formatCompact(e.tokens)}
                  sub={`${formatPercent(e.share)} · ${formatInt(e.responses)} responses`}
                />
              ))}
            </>
          ) : null}
        </View>
      );
    }
    case "tools": {
      if (b.toolCalls === 0) return <EmptyState title="No tool calls in this range" />;
      const byKey = new Map(b.byTool.map((t) => [t.key, t]));
      const segments = TOOL_KINDS.filter((k) => (byKey.get(k)?.count ?? 0) > 0).map((k) => ({
        key: k,
        label: TOOL_LABELS[k],
        value: byKey.get(k)!.count,
        share: byKey.get(k)!.share,
        color: TOOL_COLORS[k],
      }));
      return (
        <View style={{ gap: 8 }}>
          <Muted>{formatInt(b.toolCalls)} tool calls</Muted>
          <ShareBar segments={segments} format={formatInt} />
          {b.byMcpTool.length > 0 ? (
            <>
              <Muted style={{ marginTop: 6 }}>MCP tools (server/tool)</Muted>
              {b.byMcpTool.map((t) => (
                <KeyValue key={t.key} label={t.key} value={formatInt(t.count)} />
              ))}
            </>
          ) : null}
        </View>
      );
    }
    case "projects":
      if (b.byProject.length === 0) return <EmptyState title="No projects in this range" />;
      return (
        <View>
          {b.byProject.map((r) => (
            <KeyValue
              key={r.key}
              label={r.key}
              value={formatCompact(r.tokens)}
              sub={`${formatPercent(r.share)} · ${formatInt(r.sessions)} sessions · +${formatInt(r.linesAdded)} / −${formatInt(r.linesRemoved)}`}
            />
          ))}
        </View>
      );
    case "skills":
      if (b.bySkill.length === 0) return <EmptyState title="No skill use in this range" />;
      return (
        <View>
          {b.bySkill.map((r) => (
            <KeyValue
              key={r.key}
              label={r.key}
              value={formatInt(r.count)}
              sub={`${formatInt(r.sessions)} sessions`}
            />
          ))}
        </View>
      );
    case "machines":
      if (b.byMachine.length === 0) return <EmptyState title="No machine data in this range" />;
      return (
        <View>
          {b.byMachine.map((r) => (
            <KeyValue
              key={r.key}
              label={r.label}
              value={formatCompact(r.tokens)}
              sub={`${formatPercent(r.share)} · ${formatInt(r.sessions)} sessions`}
            />
          ))}
        </View>
      );
    case "sources":
      if (b.bySource.length === 0) return <EmptyState title="No sessions in this range" />;
      return (
        <View>
          {b.bySource.map((r) => (
            <KeyValue
              key={r.key}
              label={sourceLabel(r.key)}
              value={formatCompact(r.tokens)}
              sub={`${formatPercent(r.share)} · ${formatInt(r.sessions)} sessions`}
            />
          ))}
        </View>
      );
  }
}

/** Models / Tools / Projects / Skills / Machines / Sources, one card with a segmented switch. */
export function Breakdowns({
  range,
  userId,
  sections = SECTIONS,
}: {
  range: ResolvedRange;
  userId?: Id<"users">;
  sections?: { value: Section; label: string }[];
}) {
  const [section, setSection] = useState<Section>(sections[0]?.value ?? "models");
  const { data, isStale } = useStableQuery(api.stats.breakdowns, {
    from: range.from,
    to: range.to,
    userId,
  });
  return (
    <SectionCard
      title="Breakdown"
      actions={
        <SegmentedControl
          label="Breakdown"
          options={sections}
          value={section}
          onChange={setSection}
        />
      }
    >
      {!data ? (
        <Skeleton height={160} />
      ) : (
        <View style={{ opacity: isStale ? 0.6 : 1 }}>
          <Body b={data} section={section} />
          <Muted style={{ marginTop: 8 }}>{formatCompact(data.totalTokens)} tokens in total</Muted>
        </View>
      )}
    </SectionCard>
  );
}
