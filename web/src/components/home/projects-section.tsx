"use client";

import type { Id } from "@convex/_generated/dataModel";
import type { BreakdownsResult } from "@convex/lib/types";
import { DataTable, type Column } from "@/components/primitives/data-table";
import { EmptyState } from "@/components/primitives/empty-state";
import { QuerySection } from "@/components/primitives/query-section";
import { useBreakdowns } from "@/hooks/use-breakdowns";
import { csvFilename } from "@/lib/csv";
import { formatCompact, formatInt, formatPercent } from "@/lib/format";
import type { ResolvedRange } from "@/lib/range";

type ProjectRow = BreakdownsResult["byProject"][number];

export function ProjectsSection({ range, userId }: { range: ResolvedRange; userId?: Id<"users"> }) {
  const { data, isStale } = useBreakdowns(range, userId);
  const columns: Column<ProjectRow>[] = [
    { key: "project", header: "Project", render: (r) => r.key },
    {
      key: "tokens",
      header: "Tokens",
      align: "right",
      csv: (r) => r.tokens,
      bar: (r) => r.tokens,
      render: (r) => formatCompact(r.tokens),
    },
    {
      key: "share",
      header: "Share",
      align: "right",
      csv: (r) => r.share,
      render: (r) => formatPercent(r.share),
    },
    {
      key: "sessions",
      header: "Sessions",
      align: "right",
      csv: (r) => r.sessions,
      render: (r) => formatInt(r.sessions),
    },
    {
      key: "messages",
      header: "User messages",
      align: "right",
      hideBelow: "md",
      csv: (r) => r.userMessages,
      render: (r) => formatInt(r.userMessages),
    },
    {
      key: "lines",
      header: "Lines +/−",
      align: "right",
      hideBelow: "sm",
      csv: (r) => `+${r.linesAdded} / -${r.linesRemoved}`,
      render: (r) => `+${formatInt(r.linesAdded)} / −${formatInt(r.linesRemoved)}`,
    },
  ];
  return (
    <QuerySection
      title="Projects"
      info="Project = the last path segment of the session's working directory. Full paths are never uploaded."
      data={data}
      isStale={isStale}
    >
      {(b) =>
        b.byProject.length === 0 ? (
          <EmptyState title="No projects in this range" />
        ) : (
          <DataTable
            columns={columns}
            rows={b.byProject}
            rowKey={(r) => r.key}
            exportFilename={csvFilename("projects", range)}
          />
        )
      }
    </QuerySection>
  );
}
