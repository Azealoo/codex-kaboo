import type { CostByKind } from "@convex/lib/types";
import { StackedShareBar } from "@/components/charts/stacked-share-bar";
import { InfoTooltip } from "@/components/primitives/info-tooltip";
import { Card } from "@/components/ui/card";
import { costStructureSegments } from "@/lib/chart-data";
import { formatUsd } from "@/lib/format";

export function CostStructureCard({
  costByKind,
  costUsd,
  cacheSavingsUsd,
  unpricedModels,
}: {
  costByKind: CostByKind;
  costUsd: number;
  cacheSavingsUsd: number;
  unpricedModels?: string[];
}) {
  return (
    <Card className="gap-3 rounded-lg border-border p-4 shadow-none md:col-span-2 xl:col-span-1">
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <span>Cost structure</span>
        <InfoTooltip text="Estimated cost split into uncached input, cached input, output and reasoning tokens at API list prices. Reasoning is billed as output." />
        <span className="ml-auto text-sm font-semibold text-foreground">{formatUsd(costUsd)}</span>
      </div>
      <StackedShareBar segments={costStructureSegments(costByKind)} format={formatUsd} />
      <p className="text-xs text-muted-foreground">Cache savings {formatUsd(cacheSavingsUsd)} vs. no caching</p>
      {unpricedModels && unpricedModels.length > 0 ? (
        <p className="text-xs text-muted-foreground">Unpriced: {unpricedModels.join(", ")}</p>
      ) : null}
    </Card>
  );
}
