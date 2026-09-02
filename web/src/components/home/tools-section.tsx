"use client";

import type { Id } from "@convex/_generated/dataModel";
import type { BreakdownsResult } from "@convex/lib/types";
import { StackedShareBar } from "@/components/charts/stacked-share-bar";
import { DataTable, type Column } from "@/components/primitives/data-table";
import { EmptyState } from "@/components/primitives/empty-state";
import { QuerySection } from "@/components/primitives/query-section";
import { StatCard } from "@/components/primitives/stat-card";
import { useBreakdowns } from "@/hooks/use-breakdowns";
import { toolSegments } from "@/lib/breakdowns";
import { formatInt, formatPercent } from "@/lib/format";
import type { ResolvedRange } from "@/lib/range";

type McpRow = BreakdownsResult["byMcpTool"][number];

export function ToolsSection({ range, userId }: { range: ResolvedRange; userId?: Id<"users"> }) {
  const { data, isStale } = useBreakdowns(range, userId);
  const mcpColumns: Column<McpRow>[] = [
    { key: "tool", header: "MCP tool (server/tool)", render: (r) => r.key },
    { key: "count", header: "Calls", align: "right", bar: (r) => r.count, render: (r) => formatInt(r.count) },
  ];
  return (
    <QuerySection
      title="Tools"
      description={(b) => `${formatInt(b.toolCalls)} tool calls`}
      info="Tool calls by kind: commands are classified by Codex (read, list, search, other); file changes, web search, image views and MCP tools are counted from completed items."
      data={data}
      isStale={isStale}
      bodyClassName="flex flex-col gap-4"
    >
      {(b) => {
        const segments = toolSegments(b.byTool);
        return b.toolCalls === 0 ? (
          <EmptyState title="No tool calls in this range" />
        ) : (
          <>
            <StackedShareBar segments={segments} format={formatInt} showLegend={false} />
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {segments.map((s) => (
                <StatCard key={s.key} label={s.label} value={s.value} kind="count" size="sm" footer={formatPercent(s.share)} />
              ))}
            </div>
            {b.byMcpTool.length > 0 ? <DataTable columns={mcpColumns} rows={b.byMcpTool} rowKey={(r) => r.key} /> : null}
          </>
        );
      }}
    </QuerySection>
  );
}
