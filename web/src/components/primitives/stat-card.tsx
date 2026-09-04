import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatMetricValue, type GoodDirection, type MetricKind } from "@/lib/metrics";
import { cn } from "@/lib/utils";
import { DeltaPill } from "./delta-pill";
import { InfoTooltip } from "./info-tooltip";

type StatCardProps = {
  label: string;
  value: number | null | ReactNode;
  kind?: MetricKind;
  change?: number | null;
  goodDirection?: GoodDirection;
  help?: string;
  badge?: string;
  footer?: ReactNode;
  size?: "md" | "sm";
  className?: string;
};

export function StatCard({
  label,
  value,
  kind = "count",
  change = null,
  goodDirection = "up",
  help,
  badge,
  footer,
  size = "md",
  className,
}: StatCardProps) {
  const rendered =
    typeof value === "number" || value === null ? formatMetricValue(kind, value) : value;
  return (
    <Card className={cn("gap-1 rounded-lg border-border p-3 shadow-none sm:p-4", className)}>
      {/*
        `flex-wrap` + `min-w-0` keep the badge inside the card. Badge is `shrink-0` and
        `whitespace-nowrap` by design, so in a narrow column (the user page renders these
        7-across) an unwrappable row pushed it past the card edge, where its own
        `overflow-hidden` clipped "API list price" to "API list pri". Letting the row wrap drops
        the badge to a second line instead; letting the label shrink keeps that rare.
      */}
      <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        <span className="min-w-0">{label}</span>
        {help ? <InfoTooltip text={help} /> : null}
        {badge ? (
          <Badge variant="outline" className="ml-auto rounded-full text-[10px] font-medium">
            {badge}
          </Badge>
        ) : null}
      </div>
      <div className="flex items-end justify-between gap-2">
        <span
          className={cn(
            "font-semibold leading-none tabular",
            size === "md" ? "text-xl sm:text-2xl" : "text-lg",
          )}
        >
          {rendered}
        </span>
        <DeltaPill change={change} goodDirection={goodDirection} />
      </div>
      {footer ? <div className="text-xs text-muted-foreground">{footer}</div> : null}
    </Card>
  );
}
