import type { Column } from "@/components/primitives/data-table";
import { Badge } from "@/components/ui/badge";
import type { ModelTableRow } from "@/lib/breakdowns";
import { EM_DASH, formatCompact, formatInt, formatPercent, formatUsd } from "@/lib/format";

/** The single per-model table definition. `responses` and `usdPerMTok` are opt-in columns. */
export function modelTableColumns(
  options: { responses?: boolean; usdPerMTok?: boolean } = {},
): Column<ModelTableRow>[] {
  const columns: Column<ModelTableRow>[] = [
    { key: "model", header: "Model", render: (r) => r.model },
    {
      key: "tokens",
      header: "Tokens",
      align: "right",
      bar: (r) => r.tokens,
      render: (r) => formatCompact(r.tokens),
    },
    { key: "share", header: "Share", align: "right", render: (r) => formatPercent(r.share) },
  ];
  if (options.responses) {
    columns.push({
      key: "responses",
      header: "Responses",
      align: "right",
      render: (r) => formatInt(r.responses),
    });
  }
  columns.push(
    {
      key: "cache",
      header: "Cache hit",
      align: "right",
      render: (r) => formatPercent(r.cacheHitRate),
    },
    {
      key: "cost",
      header: "Est. cost",
      align: "right",
      render: (r) =>
        r.costUsd === null ? (
          <Badge variant="outline" className="rounded-full text-[10px]">
            unpriced
          </Badge>
        ) : (
          formatUsd(r.costUsd)
        ),
    },
  );
  if (options.usdPerMTok) {
    columns.push({
      key: "rate",
      header: "$ / M tokens",
      align: "right",
      render: (r) => (r.usdPerMTok === null ? EM_DASH : formatUsd(r.usdPerMTok)),
    });
  }
  return columns;
}
