import type { ReactNode } from "react";
import type { Metric, MetricKey } from "@convex/lib/types";
import { StatCard } from "@/components/primitives/stat-card";
import { METRIC_DEFS } from "@/lib/metrics";

export function MetricStatCard({
  metricKey,
  metric,
  badge,
  footer,
  size = "md",
}: {
  metricKey: MetricKey;
  metric: Metric;
  badge?: string;
  footer?: ReactNode;
  size?: "md" | "sm";
}) {
  const def = METRIC_DEFS[metricKey];
  return (
    <StatCard
      label={def.label}
      value={metric.current}
      kind={def.kind}
      change={metric.previous === null ? null : metric.change}
      goodDirection={def.goodDirection}
      help={def.help}
      badge={badge}
      footer={footer}
      size={size}
    />
  );
}
