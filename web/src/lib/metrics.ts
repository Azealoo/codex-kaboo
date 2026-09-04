import type { Metric, MetricKey, SummaryResult } from "@convex/lib/types";

/**
 * Metric definitions (labels, kinds, polarity, help text) live in `shared/src/metric-defs.ts` so
 * the mobile app labels the same keys identically. Only `metricOf`, which needs the Convex result
 * type, is web-specific.
 */
export * from "@shared/metric-defs";

export function metricOf(summary: SummaryResult | undefined, key: MetricKey): Metric | null {
  return summary ? summary.metrics[key] : null;
}
