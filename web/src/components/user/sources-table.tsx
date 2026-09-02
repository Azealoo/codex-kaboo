"use client";

import type { Id } from "@convex/_generated/dataModel";
import type { BreakdownsResult } from "@convex/lib/types";
import { DataTable, type Column } from "@/components/primitives/data-table";
import { EmptyState } from "@/components/primitives/empty-state";
import { QuerySection } from "@/components/primitives/query-section";
import { useBreakdowns } from "@/hooks/use-breakdowns";
import { sourceLabel } from "@/lib/breakdowns";
import { formatCompact, formatInt, formatPercent } from "@/lib/format";
import type { ResolvedRange } from "@/lib/range";

type SourceRow = BreakdownsResult["bySource"][number];

export function SourcesTable({ range, userId }: { range: ResolvedRange; userId: Id<"users"> }) {
  const { data, isStale } = useBreakdowns(range, userId);
  const columns: Column<SourceRow>[] = [
    { key: "source", header: "Source", render: (r) => sourceLabel(r.key) },
    {
      key: "tokens",
      header: "Tokens",
      align: "right",
      bar: (r) => r.tokens,
      render: (r) => formatCompact(r.tokens),
    },
    { key: "sessions", header: "Sessions", align: "right", render: (r) => formatInt(r.sessions) },
    { key: "share", header: "Share", align: "right", render: (r) => formatPercent(r.share) },
  ];
  return (
    <QuerySection
      title="Sources"
      info="Where the work ran: the interactive CLI, `codex exec`, an editor extension, MCP, or a sub-agent thread."
      data={data}
      isStale={isStale}
      skeletonClassName="h-32"
    >
      {(b) =>
        b.bySource.length === 0 ? (
          <EmptyState title="No sessions in this range" />
        ) : (
          <DataTable columns={columns} rows={b.bySource} rowKey={(r) => r.key} />
        )
      }
    </QuerySection>
  );
}
