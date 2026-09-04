"use client";

import type { Id } from "@convex/_generated/dataModel";
import type { BreakdownsResult } from "@convex/lib/types";
import { DataTable, type Column } from "@/components/primitives/data-table";
import { EmptyState } from "@/components/primitives/empty-state";
import { QuerySection } from "@/components/primitives/query-section";
import { useBreakdowns } from "@/hooks/use-breakdowns";
import { csvFilename } from "@/lib/csv";
import { formatInt } from "@/lib/format";
import type { ResolvedRange } from "@/lib/range";

type SkillRow = BreakdownsResult["bySkill"][number];

export function SkillsSection({ range, userId }: { range: ResolvedRange; userId?: Id<"users"> }) {
  const { data, isStale } = useBreakdowns(range, userId);
  const columns: Column<SkillRow>[] = [
    { key: "skill", header: "Skill", render: (r) => r.key },
    {
      key: "count",
      header: "Invocations",
      align: "right",
      csv: (r) => r.count,
      bar: (r) => r.count,
      render: (r) => formatInt(r.count),
    },
    {
      key: "sessions",
      header: "Sessions",
      align: "right",
      csv: (r) => r.sessions,
      render: (r) => formatInt(r.sessions),
    },
  ];
  return (
    <QuerySection
      title="Skills"
      info="A skill is counted whenever a command reads a SKILL.md file; the skill name is its parent directory."
      data={data}
      isStale={isStale}
    >
      {(b) =>
        b.bySkill.length === 0 ? (
          <EmptyState title="No skill use in this range" />
        ) : (
          <DataTable
            columns={columns}
            rows={b.bySkill}
            rowKey={(r) => r.key}
            exportFilename={csvFilename("skills", range)}
          />
        )
      }
    </QuerySection>
  );
}
