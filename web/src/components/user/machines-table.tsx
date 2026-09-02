"use client";

import type { Id } from "@convex/_generated/dataModel";
import type { BreakdownsResult } from "@convex/lib/types";
import { DataTable, type Column } from "@/components/primitives/data-table";
import { EmptyState } from "@/components/primitives/empty-state";
import { QuerySection } from "@/components/primitives/query-section";
import { useBreakdowns } from "@/hooks/use-breakdowns";
import { formatCompact, formatInt, formatPercent } from "@/lib/format";
import type { ResolvedRange } from "@/lib/range";

type MachineRow = BreakdownsResult["byMachine"][number];

export function MachinesTable({ range, userId }: { range: ResolvedRange; userId: Id<"users"> }) {
  const { data, isStale } = useBreakdowns(range, userId);
  const columns: Column<MachineRow>[] = [
    { key: "machine", header: "Machine", render: (r) => r.label },
    { key: "tokens", header: "Tokens", align: "right", bar: (r) => r.tokens, render: (r) => formatCompact(r.tokens) },
    { key: "share", header: "Share", align: "right", render: (r) => formatPercent(r.share) },
    { key: "sessions", header: "Sessions", align: "right", render: (r) => formatInt(r.sessions) },
  ];
  return (
    <QuerySection
      title="Machines"
      info="Tokens per synced machine in the range. Rename machines on the Settings page."
      data={data}
      isStale={isStale}
      skeletonClassName="h-32"
    >
      {(b) => (b.byMachine.length === 0 ? <EmptyState title="No machine data in this range" /> : <DataTable columns={columns} rows={b.byMachine} rowKey={(r) => r.key} />)}
    </QuerySection>
  );
}
