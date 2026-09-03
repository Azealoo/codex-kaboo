"use client";

import { useState } from "react";
import type { Id } from "@convex/_generated/dataModel";
import type { BreakdownsResult } from "@convex/lib/types";
import { StackedShareBar } from "@/components/charts/stacked-share-bar";
import { DataTable, type Column } from "@/components/primitives/data-table";
import { EmptyState } from "@/components/primitives/empty-state";
import { QuerySection } from "@/components/primitives/query-section";
import { SegmentedControl } from "@/components/primitives/segmented-control";
import { useBreakdowns } from "@/hooks/use-breakdowns";
import { useModelColors } from "@/hooks/use-entity-colors";
import { modelSegments, modelTableRows, sourceSegments } from "@/lib/breakdowns";
import { colorFor } from "@/lib/colors";
import { formatCompact, formatInt, formatNullable, formatPercent } from "@/lib/format";
import type { ResolvedRange } from "@/lib/range";
import { modelTableColumns } from "./model-columns";

const GRAINS = [
  { value: "model", label: "By model" },
  { value: "effort", label: "By effort" },
] as const;

type EffortRow = BreakdownsResult["byEffort"][number];

export function ModelsSection({ range, userId }: { range: ResolvedRange; userId?: Id<"users"> }) {
  const { data, isStale } = useBreakdowns(range, userId);
  const [grain, setGrain] = useState<"model" | "effort">("model");
  const colors = useModelColors(data ? data.byModel.map((m) => m.key) : []);
  const modelColumns = modelTableColumns({ responses: true });
  const effortColumns: Column<EffortRow>[] = [
    { key: "effort", header: "Effort", render: (r) => r.key },
    {
      key: "tokens",
      header: "Tokens",
      align: "right",
      bar: (r) => r.tokens,
      render: (r) => formatCompact(r.tokens),
    },
    { key: "share", header: "Share", align: "right", render: (r) => formatPercent(r.share) },
    {
      key: "responses",
      header: "Responses",
      align: "right",
      render: (r) => formatInt(r.responses),
    },
  ];
  return (
    <QuerySection
      title="Models"
      info="Tokens per model (and per reasoning effort) for the range. Cost uses the price table on the Settings page."
      actions={
        <SegmentedControl
          ariaLabel="Model grain"
          options={GRAINS}
          value={grain}
          onChange={setGrain}
        />
      }
      data={data}
      isStale={isStale}
      bodyClassName="flex flex-col gap-4"
    >
      {(b) => (
        <>
          {b.byModel.length === 0 ? (
            <EmptyState title="No model usage in this range" />
          ) : grain === "model" ? (
            <>
              <StackedShareBar
                segments={modelSegments(b.byModel, colors)}
                format={formatCompact}
                showLegend={false}
              />
              <DataTable
                columns={modelColumns}
                rows={modelTableRows(b.byModel)}
                rowKey={(r) => r.model}
                barColor={(r) => colorFor(colors, r.model)}
              />
            </>
          ) : (
            <DataTable columns={effortColumns} rows={b.byEffort} rowKey={(r) => r.key} />
          )}
          {b.bySource.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs text-muted-foreground">By source</p>
              <StackedShareBar segments={sourceSegments(b.bySource)} format={formatCompact} />
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {formatNullable(b.totalTokens, formatCompact)} tokens in total
          </p>
        </>
      )}
    </QuerySection>
  );
}
