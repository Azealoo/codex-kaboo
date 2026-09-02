import { formatMetricValue, type MetricKind } from "@/lib/metrics";
import { cn } from "@/lib/utils";

export function Num({ value, kind, className }: { value: number | null; kind: MetricKind; className?: string }) {
  return <span className={cn("tabular", className)}>{formatMetricValue(kind, value)}</span>;
}
