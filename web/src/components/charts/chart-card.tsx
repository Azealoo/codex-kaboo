"use client";

import { useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/primitives/data-table";
import { EmptyState } from "@/components/primitives/empty-state";
import { SectionCard } from "@/components/primitives/section-card";
import { SegmentedControl } from "@/components/primitives/segmented-control";
import type { ChartRow, Stacked } from "@/lib/chart-data";
import { ChartLegend } from "./chart-legend";

const MODES = [
  { value: "chart", label: "Chart" },
  { value: "table", label: "Table" },
] as const;

function rowTotal(row: ChartRow, keys: string[]): number {
  return keys.reduce((acc, k) => acc + Number(row[k] ?? 0), 0);
}

export function ChartCard({
  title,
  description,
  help,
  actions,
  stacked,
  format,
  showPeak = true,
  legendShape = "rect",
  footer,
  children,
}: {
  title: string;
  description?: string;
  help?: string;
  actions?: ReactNode;
  stacked: Stacked;
  format: (value: number) => string;
  showPeak?: boolean;
  legendShape?: "rect" | "line";
  /** Shown below the chart or table, in either mode — e.g. an "Unpriced: …" caveat that qualifies
   *  dollar figures visible in both views. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  const [mode, setMode] = useState<"chart" | "table">("chart");
  const keys = stacked.series.map((s) => s.key);
  const columns: Column<ChartRow>[] = [
    { key: "x", header: "Period", render: (r) => r.label },
    ...stacked.series.map((s): Column<ChartRow> => ({
      key: s.key,
      header: s.label,
      align: "right",
      render: (r) => format(Number(r[s.key] ?? 0)),
    })),
    { key: "total", header: "Total", align: "right", render: (r) => format(rowTotal(r, keys)) },
  ];
  return (
    <SectionCard
      title={title}
      description={description}
      help={help}
      actions={
        <>
          {showPeak && stacked.peak ? (
            <Badge variant="outline" className="rounded-full font-normal">
              Peak {format(stacked.peak.total)} · {stacked.peak.label}
            </Badge>
          ) : null}
          {actions}
          <SegmentedControl ariaLabel="Display" options={MODES} value={mode} onChange={setMode} />
        </>
      }
      bodyClassName="flex flex-col gap-3"
    >
      {stacked.rows.length === 0 ? (
        <EmptyState title="No data in this range" />
      ) : mode === "chart" ? (
        <>
          {children}
          <ChartLegend series={stacked.series} shape={legendShape} />
        </>
      ) : (
        <DataTable columns={columns} rows={stacked.rows} rowKey={(r) => r.x} />
      )}
      {footer}
    </SectionCard>
  );
}
