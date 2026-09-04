import type { SessionRow } from "@convex/lib/types";
import { sourceLabel } from "./breakdowns";

/**
 * The text a free-text session filter matches against: the fields a person remembers a session
 * by. Machine label and user name are included so "otter" or "alice" narrow a team list too.
 */
export function sessionSearchText(s: SessionRow): string {
  return [
    s.project,
    s.gitBranch ?? "",
    s.model,
    s.effort ?? "",
    sourceLabel(s.source, s.isSubagent),
    s.source,
    s.machineLabel,
    s.userName,
  ]
    .join(" ")
    .toLowerCase();
}

/** Every whitespace-separated term must appear somewhere in the row (case-insensitive). */
export function filterSessions(rows: SessionRow[], query: string): SessionRow[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return rows;
  return rows.filter((row) => {
    const text = sessionSearchText(row);
    return terms.every((term) => text.includes(term));
  });
}

/**
 * Tokens for the row's tool activity, non-zero kinds only, busiest first — what the detail view
 * lists under "Tools".
 */
export function toolBreakdown(
  counts: SessionRow["toolCounts"],
  labels: Record<keyof SessionRow["toolCounts"], string>,
): { key: string; label: string; count: number }[] {
  return (Object.keys(counts) as (keyof SessionRow["toolCounts"])[])
    .map((key) => ({ key, label: labels[key], count: counts[key] }))
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : 1));
}
