import type { LeaderboardRow } from "@convex/lib/types";
import type { MetricKind } from "./metrics";

export type LeaderMetric = "tokens" | "cost" | "sessions" | "messages" | "lines" | "tokensPerLine";

export const LEADER_METRICS: { value: LeaderMetric; label: string }[] = [
  { value: "tokens", label: "Tokens" },
  { value: "cost", label: "Cost" },
  { value: "sessions", label: "Sessions" },
  { value: "messages", label: "Messages" },
  { value: "lines", label: "Generated lines" },
  { value: "tokensPerLine", label: "Tokens per line" },
];

export function leaderValue(row: LeaderboardRow, metric: LeaderMetric): number | null {
  switch (metric) {
    case "tokens":
      return row.tokens.total;
    case "cost":
      return row.costUsd;
    case "sessions":
      return row.sessions;
    case "messages":
      return row.messages;
    case "lines":
      return row.linesAdded;
    case "tokensPerLine":
      return row.tokensPerLine;
  }
}

export function leaderKind(metric: LeaderMetric): MetricKind {
  switch (metric) {
    case "tokens":
    case "tokensPerLine":
      return "tokens";
    case "cost":
      return "usd";
    default:
      return "count";
  }
}

export function sortLeaderboard(rows: LeaderboardRow[], metric: LeaderMetric): LeaderboardRow[] {
  return [...rows].sort((a, b) => {
    const va = leaderValue(a, metric);
    const vb = leaderValue(b, metric);
    if (va === null && vb === null) return a.name.localeCompare(b.name);
    if (va === null) return 1;
    if (vb === null) return -1;
    return vb - va || a.name.localeCompare(b.name);
  });
}
