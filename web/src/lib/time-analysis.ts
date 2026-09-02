import { ratio } from "@shared/metrics";
import type { DayHourHeatmapResult, SummaryResult } from "@convex/lib/types";
import { formatDurationMs, formatHours, formatPercent } from "./format";
import { WEEKDAY_LABELS, hourLabel } from "./heatmap";

export function peakHour(byHour: number[]): number | null {
  let best: number | null = null;
  let bestValue = 0;
  for (let h = 0; h < byHour.length; h++) {
    const v = byHour[h] ?? 0;
    if (v > bestValue) {
      bestValue = v;
      best = h;
    }
  }
  return best;
}

export type TimeRow = { label: string; value: string; help: string };

export function timeAnalysisRows(summary: SummaryResult, byHour: number[], heatmap: DayHourHeatmapResult): TimeRow[] {
  const m = summary.metrics;
  const perSession = ratio(m.messages.current, m.sessions.current);
  const hour = heatmap.peakHour ?? peakHour(byHour);
  return [
    { label: "Total hours", value: formatHours(m.wallMs.current), help: "Sum of session spans (first to last event)." },
    { label: "Active hours", value: formatHours(m.activeMs.current), help: "Sum of turn durations while the model was working." },
    { label: "Active rate", value: formatPercent(m.activeRate.current), help: "Active hours divided by total hours." },
    { label: "Avg session", value: formatDurationMs(m.avgSessionActiveMs.current), help: "Active time per session." },
    { label: "Messages / session", value: perSession === null ? "—" : perSession.toFixed(1), help: "User plus agent messages per session." },
    { label: "Peak hour", value: hour === null ? "—" : `${hourLabel(hour)}:00`, help: "Hour of day with the most tokens (machine time zone)." },
    { label: "Most active day", value: heatmap.peakWeekday === null ? "—" : WEEKDAY_LABELS[heatmap.peakWeekday]!, help: "Weekday with the most tokens." },
  ];
}
